import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { World } from '../World';
import { WORLD3D, MAPGEO, ROADS } from '../config';
import { getRegion, regionIds } from '../maps/registry';
import type { Region, RegionRiver, RegionLake } from '../maps/types';
import {
  AuthoredField,
  BUILDING_KINDS,
  type BuildingKind,
  type TerrainDab,
  type FoliageDab,
  type AuthoredBuilding,
  type ProjectedDab,
} from '../world/authored';
import { createTerrain } from '../meshes/terrain';
import { createTreeField, type TreeField } from '../meshes/trees';
import { createRiverMesh } from '../meshes/river';
import { createRoadMesh } from '../meshes/road';
import { Lake } from '../Lake';
import { createStructure, type StructureMesh } from '../meshes/cabin';
import { createBridge, computeBridgeSites } from '../meshes/bridges';
import { createWaterMaterial } from '../water/WaterMaterial';
import { Ripples } from '../water/Ripples';
import { FrameContext } from '../render/FrameContext';
import { createSkyDome } from '../sky/SkyDome';
import { applyAtmosphere, SKY_PRESETS, SUN_DISTANCE } from '../sky/TimeOfDay';
import { buildEditorUI, type EditorUI } from './EditorUI';

/**
 * In-3D map editor (the `?editor` route). Renders the REAL map in 3D — the same `World` + the same mesh
 * builders the game uses — and lets you SCULPT it directly: raise/lower terrain with a brush, paint or
 * clear forest, and drop decorative buildings on the ground. It authors the three hand-painted layers
 * from world/authored.ts (terrain / foliage / buildings), pinned at real lat/lon, and Export emits
 * paste-ready `maps/<region>/region.ts` const blocks per map.
 *
 * Fidelity model: terrain sculpting uses the EXACT same `AuthoredField` (falloff + projection) the engine
 * bakes into `baseHeight`, applied on top of the real `World.groundHeightAt`, so the sculpted SURFACE is
 * identical to what the game grows — without a costly full-world rebuild on every stroke. (Secondary
 * objects — lake water level, tree/building Y — are sampled against the base ground in the live preview;
 * they re-settle exactly when the game loads the exported data. Switch maps or re-pick a tool to refresh.)
 *
 * Lazy-loaded from main.ts so none of this ships in a player's bundle.
 */

type Tool = 'orbit' | 'raise' | 'lower' | 'paint-trees' | 'clear-trees' | 'building' | 'river' | 'lake' | 'select';

/** A building instance in the editor: the data record + its live mesh, so select/move can track both. */
interface BuildingInstance {
  ref: AuthoredBuilding;
  mesh: StructureMesh;
}

const SEGMENTS = 200; // terrain tessellation for the editor (sculpt resolution)
const FOREST_CANDIDATES = 9000; // forest density for the preview (lighter than the game's area-scaled count)

export class MapEditor {
  private readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly frame = new FrameContext();
  private readonly ripples = new Ripples();
  private readonly sun = new THREE.DirectionalLight();
  private readonly hemi = new THREE.HemisphereLight();
  private readonly raycaster = new THREE.Raycaster();
  private readonly ui: EditorUI;

  // --- the map being edited ---------------------------------------------------
  private mapId: string;
  private base!: Region; // the source region (everything EXCEPT the three editor layers)
  private terrainDabs: TerrainDab[] = [];
  private foliageDabs: FoliageDab[] = [];
  private buildings: AuthoredBuilding[] = [];
  private rivers: RegionRiver[] = []; // base rivers + any drawn in 3D (carved into the World)
  private namedLakes: RegionLake[] = []; // base named lakes + any dug in 3D

  // --- the live world + scene -------------------------------------------------
  private world!: World;
  private terrainField!: AuthoredField; // committed terrain dabs (the painted offset)
  private foliageField!: AuthoredField; // committed foliage dabs (the painted density bias)
  private terrainMesh!: THREE.Mesh;
  private committedBase!: Float32Array; // base ground Y per terrain vertex (no painted terrain)
  private forest: TreeField | null = null;
  private buildingInstances: BuildingInstance[] = [];
  private waterMat!: THREE.Material;
  private readonly transient: THREE.Object3D[] = []; // rebuilt per map (removed/disposed on switch)

  // --- interaction state ------------------------------------------------------
  private tool: Tool = 'orbit';
  private brushKm = 8;
  private terrainStrengthM = 40;
  private foliageStrength = 1;
  private buildingKind: BuildingKind = 'cabin';
  private stroking = false;
  private strokeDabs: ProjectedDab[] = [];
  private lastStamp: THREE.Vector2 | null = null;
  private selected: BuildingInstance | null = null;
  private readonly brushRing: THREE.Line;
  private readonly labelsGroup = new THREE.Group(); // 3D name billboards (toggleable)
  private showLabels = true;
  private riverDraft: { lat: number; lon: number }[] = []; // points of the river being drawn
  private riverPreview: THREE.Line | null = null;

  private prevTime = 0;
  private readonly ground = new THREE.Vector3(); // scratch for raycast hits

  constructor(
    private readonly container: HTMLElement,
    mapId: string | undefined,
  ) {
    this.mapId = mapId && regionIds().includes(mapId) ? mapId : regionIds()[0];

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.02;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(55, container.clientWidth / container.clientHeight, 1, 8000);
    this.camera.position.set(0, WORLD3D.size * 0.55, WORLD3D.size * 0.55);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.49; // don't drop below the horizon
    this.controls.maxDistance = WORLD3D.size * 1.4;
    this.controls.minDistance = 30;
    this.controls.listenToKeyEvents(window); // arrow keys pan
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };

    // Lights + sky (golden-hour preset, same atmosphere helper the game uses).
    this.scene.add(this.hemi);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.near = 1;
    sc.far = WORLD3D.size * 2;
    sc.left = sc.bottom = -WORLD3D.size / 2;
    sc.right = sc.top = WORLD3D.size / 2;
    this.scene.add(this.sun, this.sun.target);
    const sky = SKY_PRESETS.golden;
    this.sun.position.copy(sky.sunDir).multiplyScalar(SUN_DISTANCE);
    applyAtmosphere(this.scene, this.sun, this.hemi, sky);
    this.scene.add(createSkyDome(this.frame, sky));

    // Brush ring (a 64-seg circle hugging the cursor on the terrain).
    this.brushRing = makeBrushRing();
    this.brushRing.visible = false;
    this.scene.add(this.brushRing);
    this.scene.add(this.labelsGroup);

    this.ui = buildEditorUI(container, {
      mapId: this.mapId,
      maps: regionIds(),
      buildingKinds: BUILDING_KINDS,
      onMap: (id) => this.loadMap(id),
      onTool: (t) => this.setTool(t),
      onBrushKm: (v) => (this.brushKm = v),
      onTerrainStrength: (v) => (this.terrainStrengthM = v),
      onFoliageStrength: (v) => (this.foliageStrength = v),
      onBuildingKind: (k) => (this.buildingKind = k),
      onToggleLabels: (on) => this.setLabelsVisible(on),
      onExport: () => this.buildExport(),
      onDeleteSelected: () => this.deleteSelected(),
      onClearLayers: () => this.clearLayers(),
    });

    this.loadMap(this.mapId);
    this.bindPointer();
    window.addEventListener('resize', this.onResize);
    this.renderer.setAnimationLoop(this.tick);
  }

  // --- map loading + scene (re)build -----------------------------------------

  private loadMap(id: string): void {
    this.mapId = id;
    this.base = getRegion(id);
    this.terrainDabs = [...(this.base.terrain ?? [])];
    this.foliageDabs = [...(this.base.foliage ?? [])];
    this.buildings = (this.base.buildings ?? []).map((b) => ({ ...b }));
    this.rivers = (this.base.rivers ?? []).map((r) => clone(r)); // deep-copy so edits don't mutate the source region
    this.namedLakes = (this.base.namedLakes ?? []).map((l) => clone(l));
    this.selected = null;
    this.rebuildWorld();
    this.ui.setMap(id);
    this.ui.setNotice(
      this.world.hasGeo
        ? ''
        : `“${id}” has no geo frame yet — terrain/tree/building painting needs real lat/lon. View only.`,
    );
  }

  /** Build the base World (no editor layers) + the whole transient scene from the current map data. */
  private rebuildWorld(): void {
    for (const o of this.transient) {
      this.scene.remove(o);
      disposeObject(o);
    }
    this.transient.length = 0;
    this.forest = null;
    this.buildingInstances = [];
    this.selected = null;

    // Base world. Terrain/foliage/buildings the editor owns itself (live brushes), so they're stripped
    // here; rivers + named lakes go INTO the World so they carve the ground + grow water, matching the
    // game exactly (they're cheap to rebuild and there's no live brush for them — edits are discrete).
    this.world = new World(WORLD3D.seed, {
      regionId: this.mapId,
      region: { ...this.base, terrain: [], foliage: [], buildings: [], rivers: this.rivers, namedLakes: this.namedLakes },
    });
    // Bridges shape river valleys into the terrain — compute + register BEFORE the terrain mesh so the
    // banks are raised under each deck (same order as Game), then build the bridge meshes below.
    const bridgeSites = computeBridgeSites(this.world);
    this.world.setBridgeValleys(bridgeSites);
    this.terrainField = this.fieldFrom(this.terrainDabs, (d) => d.deltaM / MAPGEO.metresPerUnit);
    this.foliageField = this.fieldFrom(this.foliageDabs, (d) => d.density);

    // Terrain (real builder) → capture the base ground heights, then apply the painted offset on top.
    const terr = createTerrain(this.world, SEGMENTS, this.frame);
    this.terrainMesh = terr.mesh;
    const pos = this.terrainMesh.geometry.attributes.position as THREE.BufferAttribute;
    this.committedBase = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) this.committedBase[i] = pos.getY(i);
    this.add(this.terrainMesh);
    this.displaceTerrain();

    this.waterMat = createWaterMaterial(this.frame, this.ripples);
    for (const l of this.world.lakes) {
      const lake = new Lake(
        this.scene,
        l.x,
        l.z,
        l.r,
        l.waterLevel,
        48,
        (phi) => this.world.lakeRadius(l, phi),
        (x, z) => this.world.groundHeightAt(x, z),
        this.waterMat,
      );
      this.transient.push(lake.mesh); // already added to scene by Lake's ctor
    }
    for (const r of this.world.rivers) {
      this.add(createRiverMesh(r, (x, z) => this.world.groundHeightAt(x, z), this.waterMat));
    }
    const gravelMat = new THREE.MeshStandardMaterial({
      color: ROADS.gravelColor,
      roughness: 1,
      metalness: 0,
      vertexColors: true,
    });
    const roadSurfaceAt = (x: number, z: number): number => {
      const wl = this.world.waterLevelAt(x, z);
      return wl !== null ? wl + ROADS.bridgeLift : this.world.groundHeightAt(x, z) + ROADS.lift;
    };
    for (const rd of this.world.roads) this.add(createRoadMesh(rd, roadSurfaceAt, gravelMat));

    this.rebuildForest();
    for (const b of this.buildings) this.spawnBuilding(b);

    // Existing structures (so the map reads complete): a depot on every base + a small cabin cluster in
    // every forest hamlet. These are the seeded community sites, not editor-authored buildings — shown
    // for context, never selectable/exported (the editor's own buildings are separate, via spawnBuilding).
    let sSeed = 4000;
    for (const c of this.world.communities) {
      if (c.kind === 'base') {
        this.placeContextStructure('depot', c.x, c.z, sSeed++, 0);
      } else {
        const count = Math.max(1, Math.min(4, c.buildings));
        for (let k = 0; k < count; k++) {
          const a = (k / count) * Math.PI * 2;
          const rr = c.radius * 0.5;
          this.placeContextStructure('cabin', c.x + Math.cos(a) * rr, c.z + Math.sin(a) * rr, sSeed++, a);
        }
      }
    }

    // Bridges where roads/towns cross the rivers (truss + deck), built from the sites computed above.
    for (const site of bridgeSites) {
      const bridge = createBridge(site);
      this.add(bridge.group);
    }

    this.buildLabels();
  }

  /** Place a non-selectable context structure (existing community/base building) on the ground. */
  private placeContextStructure(kind: 'cabin' | 'depot', x: number, z: number, seed: number, yaw: number): void {
    const m = createStructure(kind, seed);
    m.group.position.set(x, this.surfaceAt(x, z), z);
    m.group.rotation.y = yaw;
    this.add(m.group);
  }

  /** Build the floating 3D name labels for bases/towns, named lakes, landmarks, and rivers. */
  private buildLabels(): void {
    for (const c of this.labelsGroup.children.slice()) {
      this.labelsGroup.remove(c);
      disposeObject(c);
    }
    const add = (text: string, x: number, z: number, y: number, color: string) => {
      const s = makeLabelSprite(text, color);
      s.position.set(x, this.surfaceAt(x, z) + y, z);
      this.labelsGroup.add(s);
    };
    for (const c of this.world.communities) add(c.name, c.x, c.z, c.kind === 'base' ? 26 : 18, c.kind === 'base' ? '#9ad1ff' : '#ffe08a');
    for (const l of this.world.lakes) if (l.name) add(l.name, l.x, l.z, 14, '#bfe6ff');
    for (const lm of this.world.landmarks()) add(lm.name, lm.x, lm.z, lm.kind === 'city' ? 30 : 20, '#dfe9f5');
    for (const r of this.rivers) {
      const mid = r.points[Math.floor(r.points.length / 2)];
      if (mid) {
        const p = this.world.toWorld(mid.lat, mid.lon);
        add(r.name, p.x, p.z, 16, '#7fe0f4');
      }
    }
    this.labelsGroup.visible = this.showLabels;
  }

  /** Rebuild just the forest from the current foliage field (cheap relative to a full world rebuild). */
  private rebuildForest(): void {
    if (this.forest) {
      this.scene.remove(this.forest.object);
      disposeObject(this.forest.object);
      const idx = this.transient.indexOf(this.forest.object);
      if (idx >= 0) this.transient.splice(idx, 1);
    }
    this.forest = createTreeField({
      candidates: FOREST_CANDIDATES,
      size: WORLD3D.size,
      heightAt: (x, z) => this.surfaceAt(x, z),
      sample: (x, z) => {
        const s = this.world.biomes.sample(x, z);
        const mul = Math.max(0, 1 + this.foliageField.sample(x, z));
        return { treeDensity: s.treeDensity * this.world.clearingFactor(x, z) * mul, treeTint: s.treeTint };
      },
      rng: this.world.rng,
      burnable: false,
    });
    this.add(this.forest.object);
  }

  private fieldFrom<T extends { lat: number; lon: number; radiusKm: number }>(
    dabs: readonly T[],
    amp: (d: T) => number,
  ): AuthoredField {
    const proj = dabs.map((d) => {
      const p = this.world.toWorld(d.lat, d.lon);
      return { x: p.x, z: p.z, r: d.radiusKm * this.world.unitsPerKm, amp: amp(d) };
    });
    return new AuthoredField(this.world.sizeX, this.world.sizeZ, proj);
  }

  /** Final ground surface (base + committed painted terrain) at world XZ — what objects sit on. */
  private surfaceAt(x: number, z: number): number {
    return this.world.groundHeightAt(x, z) + this.terrainField.sample(x, z);
  }

  /** Re-displace every terrain vertex: base height + committed terrain + an optional in-progress stroke. */
  private displaceTerrain(stroke?: AuthoredField): void {
    const geo = this.terrainMesh.geometry;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      let y = this.committedBase[i] + this.terrainField.sample(x, z);
      if (stroke) y += stroke.sample(x, z);
      pos.setY(i, y);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    geo.computeBoundingSphere(); // displacement moved verts — refresh bounds so the brush raycast still hits
    geo.computeBoundingBox();
  }

  private spawnBuilding(ref: AuthoredBuilding): BuildingInstance {
    const mesh = createStructure(ref.kind, 9000 + this.buildingInstances.length);
    const p = this.world.toWorld(ref.lat, ref.lon);
    mesh.group.position.set(p.x, this.surfaceAt(p.x, p.z), p.z);
    mesh.group.rotation.y = ((ref.rotationDeg ?? 0) * Math.PI) / 180;
    this.scene.add(mesh.group);
    const inst = { ref, mesh };
    this.buildingInstances.push(inst);
    this.transient.push(mesh.group);
    return inst;
  }

  private add(o: THREE.Object3D): void {
    this.scene.add(o);
    this.transient.push(o);
  }

  // --- tools + brush ----------------------------------------------------------

  private setTool(t: Tool): void {
    if (this.tool === 'river' && t !== 'river' && this.riverDraft.length) this.finishRiver(); // commit a pending river
    this.tool = t;
    // Left mouse rotates only in Orbit; otherwise it's the tool action (right-drag still rotates).
    this.controls.mouseButtons.LEFT = t === 'orbit' ? THREE.MOUSE.ROTATE : null;
    this.brushRing.visible = false;
    this.ui.setTool(t);
    if (t === 'river') this.ui.setNotice('Drawing river — click to drop points · double-click / Enter to finish · Esc cancel');
    else this.ui.setNotice(this.world.hasGeo ? '' : `“${this.mapId}” has no geo frame — view only.`);
    if (t !== 'select') this.select(null);
  }

  setLabelsVisible(on: boolean): void {
    this.showLabels = on;
    this.labelsGroup.visible = on;
  }

  private isTerrainTool(): boolean {
    return this.tool === 'raise' || this.tool === 'lower';
  }
  private isFoliageTool(): boolean {
    return this.tool === 'paint-trees' || this.tool === 'clear-trees';
  }
  private brushUnits(): number {
    return this.brushKm * this.world.unitsPerKm;
  }

  // --- pointer ----------------------------------------------------------------

  private bindPointer(): void {
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('keydown', this.onKey);
    el.addEventListener('dblclick', () => {
      if (this.tool === 'river') this.finishRiver();
    });
  }

  /** Raycast the terrain under a pointer event; returns the world hit (into `this.ground`) or null. */
  private hitTerrain(e: PointerEvent): THREE.Vector3 | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObject(this.terrainMesh, false)[0];
    if (!hit) return null;
    this.ground.copy(hit.point);
    return this.ground;
  }

  private onDown = (e: PointerEvent): void => {
    if (e.button !== 0 || this.tool === 'orbit') return; // left button only; orbit handled by controls
    if (!this.world.hasGeo && this.tool !== 'select') return;
    const hit = this.hitTerrain(e);

    if (this.tool === 'select') {
      this.pickBuilding(e);
      return;
    }
    if (this.tool === 'building') {
      if (hit) this.placeBuilding(hit.x, hit.z);
      return;
    }
    if (this.tool === 'lake') {
      if (hit) this.digLake(hit.x, hit.z);
      return;
    }
    if (this.tool === 'river') {
      if (hit) this.addRiverPoint(hit.x, hit.z);
      return;
    }
    if (!hit || (!this.isTerrainTool() && !this.isFoliageTool())) return;
    // Begin a terrain/foliage stroke.
    this.stroking = true;
    this.strokeDabs = [];
    this.lastStamp = null;
    this.controls.enabled = false;
    this.stamp(hit.x, hit.z);
  };

  private onMove = (e: PointerEvent): void => {
    const hit = this.hitTerrain(e);
    // Brush ring preview (terrain/foliage tools).
    if (hit && (this.isTerrainTool() || this.isFoliageTool())) {
      this.brushRing.visible = true;
      this.brushRing.position.set(hit.x, hit.y + 1, hit.z);
      this.brushRing.scale.setScalar(this.brushUnits());
    } else {
      this.brushRing.visible = false;
    }

    if (this.stroking && hit) {
      const moved = !this.lastStamp || this.lastStamp.distanceTo(new THREE.Vector2(hit.x, hit.z)) > this.brushUnits() * 0.4;
      if (moved) this.stamp(hit.x, hit.z);
    } else if (this.selected && (e.buttons & 1) && this.tool === 'select' && hit) {
      // Drag the selected building along the ground.
      this.selected.mesh.group.position.set(hit.x, this.surfaceAt(hit.x, hit.z), hit.z);
      const g = this.world.toLatLon(hit.x, hit.z);
      this.selected.ref.lat = g.lat;
      this.selected.ref.lon = g.lon;
    }
  };

  private onUp = (): void => {
    this.controls.enabled = true;
    if (!this.stroking) return;
    this.stroking = false;
    this.commitStroke();
  };

  /** Add one brush dab at world XZ and live-preview it (terrain re-displaces; foliage waits for commit). */
  private stamp(x: number, z: number): void {
    this.lastStamp = new THREE.Vector2(x, z);
    const r = this.brushUnits();
    if (this.isTerrainTool()) {
      const amp = (this.tool === 'raise' ? 1 : -1) * (this.terrainStrengthM / MAPGEO.metresPerUnit);
      this.strokeDabs.push({ x, z, r, amp });
      this.displaceTerrain(new AuthoredField(this.world.sizeX, this.world.sizeZ, this.strokeDabs));
    } else if (this.isFoliageTool()) {
      const amp = (this.tool === 'paint-trees' ? 1 : -1) * this.foliageStrength;
      this.strokeDabs.push({ x, z, r, amp });
    }
  }

  /** Merge the finished stroke into the committed layer + rebuild what it affects. */
  private commitStroke(): void {
    if (!this.strokeDabs.length) return;
    for (const d of this.strokeDabs) {
      const g = this.world.toLatLon(d.x, d.z);
      const radiusKm = d.r / this.world.unitsPerKm;
      if (this.isTerrainTool()) {
        this.terrainDabs.push({ lat: g.lat, lon: g.lon, radiusKm, deltaM: d.amp * MAPGEO.metresPerUnit });
      } else if (this.isFoliageTool()) {
        this.foliageDabs.push({ lat: g.lat, lon: g.lon, radiusKm, density: d.amp });
      }
    }
    this.strokeDabs = [];
    if (this.isTerrainTool()) {
      this.terrainField = this.fieldFrom(this.terrainDabs, (d) => d.deltaM / MAPGEO.metresPerUnit);
      this.displaceTerrain();
    } else if (this.isFoliageTool()) {
      this.foliageField = this.fieldFrom(this.foliageDabs, (d) => d.density);
      this.rebuildForest();
    }
    this.ui.setCounts(this.terrainDabs.length, this.foliageDabs.length, this.buildings.length);
  }

  // --- buildings --------------------------------------------------------------

  private placeBuilding(x: number, z: number): void {
    const g = this.world.toLatLon(x, z);
    const ref: AuthoredBuilding = { lat: g.lat, lon: g.lon, kind: this.buildingKind, rotationDeg: 0 };
    this.buildings.push(ref);
    this.select(this.spawnBuilding(ref));
    this.ui.setCounts(this.terrainDabs.length, this.foliageDabs.length, this.buildings.length);
  }

  private pickBuilding(e: PointerEvent): void {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    let found: BuildingInstance | null = null;
    for (const b of this.buildingInstances) {
      if (this.raycaster.intersectObject(b.mesh.group, true).length) {
        found = b;
        break;
      }
    }
    this.select(found);
  }

  private select(inst: BuildingInstance | null): void {
    this.selected = inst;
    this.ui.setSelected(inst ? inst.ref.kind : null);
  }

  private deleteSelected(): void {
    if (!this.selected) return;
    const inst = this.selected;
    this.scene.remove(inst.mesh.group);
    disposeObject(inst.mesh.group);
    this.buildings = this.buildings.filter((b) => b !== inst.ref);
    this.buildingInstances = this.buildingInstances.filter((b) => b !== inst);
    this.select(null);
    this.ui.setCounts(this.terrainDabs.length, this.foliageDabs.length, this.buildings.length);
  }

  // --- rivers + lakes ---------------------------------------------------------

  private addRiverPoint(x: number, z: number): void {
    const g = this.world.toLatLon(x, z);
    this.riverDraft.push(g);
    this.updateRiverPreview();
    this.ui.setNotice(`Drawing river — ${this.riverDraft.length} pts · double-click / Enter to finish · Esc cancel`);
  }

  private updateRiverPreview(): void {
    if (this.riverPreview) {
      this.scene.remove(this.riverPreview);
      disposeObject(this.riverPreview);
      this.riverPreview = null;
    }
    if (this.riverDraft.length < 1) return;
    const pts = this.riverDraft.map((g) => {
      const p = this.world.toWorld(g.lat, g.lon);
      return new THREE.Vector3(p.x, this.surfaceAt(p.x, p.z) + 2, p.z);
    });
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({ color: 0x7fe0f4, depthTest: false, linewidth: 2 });
    this.riverPreview = new THREE.Line(geo, mat);
    this.riverPreview.renderOrder = 998;
    this.scene.add(this.riverPreview);
  }

  private finishRiver(): void {
    const draft = this.riverDraft;
    this.riverDraft = [];
    if (this.riverPreview) {
      this.scene.remove(this.riverPreview);
      disposeObject(this.riverPreview);
      this.riverPreview = null;
    }
    this.ui.setNotice('');
    if (draft.length < 2) return; // too short → discard
    this.rivers.push({ name: `River ${this.rivers.length + 1}`, width: 14, points: draft });
    this.rebuildWorld();
    this.ui.setCounts(this.terrainDabs.length, this.foliageDabs.length, this.buildings.length);
  }

  private digLake(x: number, z: number): void {
    const g = this.world.toLatLon(x, z);
    const areaKm2 = Math.round(areaFromRadius(this.brushUnits()));
    this.namedLakes.push({ name: `Lake ${this.namedLakes.length + 1}`, lat: g.lat, lon: g.lon, areaKm2 });
    this.rebuildWorld(); // the lake carves a basin + grows a water disc on rebuild (same as the game)
  }

  private clearLayers(): void {
    if (!confirm('Clear ALL painted terrain, foliage and buildings for this map? (does not touch other layers)')) return;
    this.terrainDabs = [];
    this.foliageDabs = [];
    this.buildings = [];
    this.rebuildWorld();
    this.ui.setCounts(0, 0, 0);
  }

  private onKey = (e: KeyboardEvent): void => {
    if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'SELECT') return;
    if (this.tool === 'river' && (e.key === 'Enter' || e.key === 'Escape')) {
      if (e.key === 'Enter') this.finishRiver();
      else this.cancelRiver();
      return;
    }
    const map: Record<string, Tool> = {
      '1': 'orbit', '2': 'raise', '3': 'lower', '4': 'paint-trees', '5': 'clear-trees',
      '6': 'building', '7': 'river', '8': 'lake', '9': 'select',
    };
    if (map[e.key]) this.setTool(map[e.key]);
    else if (e.key === '[') this.ui.nudgeBrush(-2);
    else if (e.key === ']') this.ui.nudgeBrush(2);
    else if (e.key === 'Delete' || e.key === 'Backspace') this.deleteSelected();
  };

  private cancelRiver(): void {
    this.riverDraft = [];
    if (this.riverPreview) {
      this.scene.remove(this.riverPreview);
      disposeObject(this.riverPreview);
      this.riverPreview = null;
    }
    this.ui.setNotice('');
  }

  // --- export -----------------------------------------------------------------

  private buildExport(): string {
    return buildRegionsExport(this.mapId, {
      terrain: this.terrainDabs,
      foliage: this.foliageDabs,
      buildings: this.buildings,
      rivers: this.rivers,
      namedLakes: this.namedLakes,
    });
  }

  // --- loop -------------------------------------------------------------------

  private tick = (time: number): void => {
    const dt = this.prevTime ? Math.min((time - this.prevTime) / 1000, 0.1) : 0.016;
    this.prevTime = time;
    this.controls.update();
    this.frame.update(dt, 1, 0.4, this.sun.position, this.controls.target);
    this.forest?.cull(this.camera.position.x, this.camera.position.z);
    this.renderer.render(this.scene, this.camera);
  };

  private onResize = (): void => {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };
}

// --- helpers ------------------------------------------------------------------

/** A unit-radius circle in the XZ plane (scaled to the brush radius each frame) for the cursor ring. */
function makeBrushRing(): THREE.Line {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)));
  }
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const mat = new THREE.LineBasicMaterial({ color: 0x6fe0ff, transparent: true, opacity: 0.9, depthTest: false });
  const line = new THREE.Line(geo, mat);
  line.renderOrder = 999;
  return line;
}

/** Recursively dispose an object's geometries/materials so map switches don't leak GPU memory. */
function disposeObject(o: THREE.Object3D): void {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else if (mat) mat.dispose();
  });
}

/** Build the paste-ready maps/<region>/region.ts const blocks for one map's editor-authored layers. */
function buildRegionsExport(
  mapId: string,
  data: {
    terrain: readonly TerrainDab[];
    foliage: readonly FoliageDab[];
    buildings: readonly AuthoredBuilding[];
    rivers: readonly RegionRiver[];
    namedLakes: readonly RegionLake[];
  },
): string {
  const NAME = mapId.toUpperCase().replace(/-/g, '_');
  const n = (v: number, d = 4) => parseFloat(v.toFixed(d));
  const ll = (p: { lat: number; lon: number }) => `{ lat: ${n(p.lat)}, lon: ${n(p.lon)} }`;
  let out = `// Map editor (?editor) export for "${mapId}". Paste each const into the region's file and attach it to\n`;
  out += `// the Region object (terrain/foliage/buildings/rivers/namedLakes: ${NAME}_*). A const with no matching\n`;
  out += `// Region field trips noUnusedLocals → build fails, like SASKATCHEWAN_RIVERS. namedLakes/rivers are the\n`;
  out += `// FULL list (existing + new), so they replace the map's current consts; outlines are preserved.\n\n`;
  out += `const ${NAME}_TERRAIN: readonly TerrainDab[] = [\n`;
  out += data.terrain.map((d) => `  { lat: ${n(d.lat)}, lon: ${n(d.lon)}, radiusKm: ${n(d.radiusKm, 2)}, deltaM: ${n(d.deltaM, 1)} },`).join('\n');
  out += `\n];\n\n`;
  out += `const ${NAME}_FOLIAGE: readonly FoliageDab[] = [\n`;
  out += data.foliage.map((d) => `  { lat: ${n(d.lat)}, lon: ${n(d.lon)}, radiusKm: ${n(d.radiusKm, 2)}, density: ${n(d.density, 2)} },`).join('\n');
  out += `\n];\n\n`;
  out += `const ${NAME}_BUILDINGS: readonly AuthoredBuilding[] = [\n`;
  out += data.buildings.map((b) => `  { lat: ${n(b.lat)}, lon: ${n(b.lon)}, kind: '${b.kind}', rotationDeg: ${n(b.rotationDeg ?? 0, 0)} },`).join('\n');
  out += `\n];\n\n`;
  out += `const ${NAME}_RIVERS: readonly RegionRiver[] = [\n`;
  out += data.rivers
    .map((r) => `  { name: '${r.name}'${r.width != null ? `, width: ${n(r.width, 0)}` : ''}, points: [${r.points.map(ll).join(', ')}] },`)
    .join('\n');
  out += `\n];\n\n`;
  out += `const ${NAME}_LAKES: readonly RegionLake[] = [\n`;
  out += data.namedLakes.map((l) => {
    const parts = [`name: '${l.name}'`, `lat: ${n(l.lat)}`, `lon: ${n(l.lon)}`];
    if (l.areaKm2 != null) parts.push(`areaKm2: ${n(l.areaKm2, 1)}`);
    if (l.outline?.length) parts.push(`outline: [${l.outline.map(ll).join(', ')}]`);
    else {
      if (l.elong != null) parts.push(`elong: ${n(l.elong, 2)}`);
      if (l.bearingDeg != null) parts.push(`bearingDeg: ${n(l.bearingDeg, 1)}`);
    }
    return `  { ${parts.join(', ')} },`;
  }).join('\n');
  out += `\n];\n`;
  return out;
}

/** A camera-facing text billboard (canvas texture sprite) for a place/lake/river name. */
function makeLabelSprite(text: string, color: string): THREE.Sprite {
  const pad = 8;
  const font = 'bold 28px system-ui, sans-serif';
  const measure = document.createElement('canvas').getContext('2d')!;
  measure.font = font;
  const w = Math.ceil(measure.measureText(text).width) + pad * 2;
  const h = 40;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.font = font;
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(6,10,13,0.9)';
  ctx.strokeText(text, pad, h / 2);
  ctx.fillStyle = color;
  ctx.fillText(text, pad, h / 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
  const sprite = new THREE.Sprite(mat);
  sprite.renderOrder = 1000;
  const scale = 0.34; // world units per canvas pixel → label height ≈ 13.6u
  sprite.scale.set(w * scale, h * scale, 1);
  return sprite;
}

/** Inverse of the MAPGEO area→radius band (units → km²) — sizes a dug lake from the brush radius. */
function areaFromRadius(rUnits: number): number {
  const t = (rUnits - MAPGEO.lakeMinR) / (MAPGEO.lakeMaxR - MAPGEO.lakeMinR);
  const sMin = Math.sqrt(MAPGEO.lakeAreaMin);
  const s = sMin + Math.max(0, Math.min(1, t)) * (Math.sqrt(MAPGEO.lakeAreaMax) - sMin);
  return Math.max(MAPGEO.lakeAreaMin, Math.min(MAPGEO.lakeAreaMax, s * s));
}

/** Structured deep-clone for region sub-objects (rivers/lakes) so editor edits never touch the source. */
function clone<T>(o: T): T {
  return JSON.parse(JSON.stringify(o)) as T;
}

/** Boot the in-3D map editor into the game container (called from main.ts for the `?editor` route). */
export function bootEditor(container: HTMLElement, mapId?: string): MapEditor {
  return new MapEditor(container, mapId);
}

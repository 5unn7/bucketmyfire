/**
 * The Hall of Fame record — ONE source for the ten honoured moments, shared by the timeline
 * (`main.ts`) and the per-event story pages (`story.ts` ← `/fireline/story/?ev=<id>`).
 *
 * THE BACKBONE RULE (inherited from the retired Field Notes engine and non-negotiable): every fact
 * here is drawn from the public record — NRCan/CWFIS, CIFFC, Parks Canada, Public Safety Canada,
 * the provincial governments, the Filmon "Firestorm 2003" review, the Alberta Horse River reviews,
 * the Canadian Encyclopedia, museum/operator records and CBC archives. Figures stay conservative
 * ("~", "more than", "at least") wherever sources vary, and NO people or deeds are invented —
 * named individuals appear only where their documented role is beyond doubt (a parish priest a
 * town was renamed for; an Aviation Hall of Fame pilot; a fire chief on the record). Where the
 * record disputes a detail (the 1961 Mars crash cause, the 2003 pilots' names), the stories say so
 * or stay collective. When editing a story, verify against the record first; when in doubt, cut.
 */

/** One honoured moment. The short fields feed the timeline card; the long fields feed the story
 *  page. `tone` picks the badge register — default warm for the heroic, `warn` for a human toll,
 *  `fire` for raw fire scale. `art` is an optional hero image under /images/halloffame/. */
export interface HofEvent {
  id: string;
  year: string;
  title: string;
  body: string;
  stat: string;
  tone?: 'warn' | 'fire';
  /** Story page: when + where, set under the title (e.g. "October 1825 · the Miramichi valley"). */
  dateline: string;
  /** Story page: the opening dek — one or two sentences that earn the read. */
  lede: string;
  /** Story page: the full story, one string per paragraph (plain text). */
  story: string[];
  /** Story page: one editorial keyline pulled out mid-story (our words, never a fake quote). */
  pull: string;
  /** Story page: what the moment left behind — the closing paragraph, set in the warm register. */
  legacy: string;
  /** Story page: three instrument chips — the numbers that matter. */
  facts: { value: string; label: string }[];
  art?: string;
}

/** The honoured moments, chronological — each verified against the public record (see the sources
 *  line both pages render). Copy stays COUNT-FREE (no "eleven moments") so adding a moment never
 *  requires a site-wide copy sweep. */
export const EVENTS: HofEvent[] = [
  {
    id: 'miramichi-1825',
    year: '1825',
    title: 'The Great Miramichi Fire · New Brunswick',
    body: "One of the largest fires ever recorded in North America tore through northern New Brunswick, levelling timber towns along the river. Canada's wildfire story starts here — before there was anyone organized to fight it.",
    stat: 'Among NA’s largest ever',
    tone: 'fire',
    dateline: 'October 7, 1825 · the Miramichi River valley, New Brunswick',
    lede: 'Before Canada had a single organized fire crew, it had a fire that swept a fifth of a province — and the only refuge was the river itself.',
    story: [
      'The summer and fall of 1825 were abnormally hot and dry across New Brunswick, then one of the great timber colonies of the British Empire. Bush fires were already common in the woods that October — settler clearing fires and logging-camp fires, smouldering unattended the way they always had. There was no one whose job it was to put them out.',
      'On the evening of October 7 the wind rose to a gale, and the scattered fires joined into one front that swept down the Miramichi valley faster than anyone could ride to warn of it.',
      'Newcastle, a town of about a thousand people, was reduced to ruins in under three hours; of its roughly 260 buildings, twelve were left standing. Among the dead were prisoners locked in the town jail, who could not flee. Douglastown was almost erased — six buildings of seventy survived. Across the river, Chatham was spared by the wind and filled with refugees by morning.',
      'There was nowhere to run but the water. People waded into the cold October river and stood there for hours while the valley burned, sharing the shallows with panicked livestock and wild animals driven from the forest. Ships at anchor caught fire on the water.',
      'About 160 people are confirmed to have died around Newcastle; estimates for the whole region run as high as 500, and the truth is unknowable — some three thousand lumbermen were dispersed in camps through the woods that night, and no record could say how many never walked out. The burned area is estimated at roughly one-fifth of New Brunswick’s forests, which still places Miramichi among the largest fires ever recorded in North America.',
      'Relief came afterward, by sailing ship — tens of thousands of pounds raised in the Maritime colonies, the Canadas, the United States and Britain, in what has been called the largest disaster-relief effort of pre-Confederation Canada. The record also keeps its omission: none of it is recorded as reaching the local Mi’kmaw communities who had lived through the same fire.',
    ],
    pull: 'No alarm, no crews, no plan — in 1825 the only thing standing between a town and the fire was the wind’s mood.',
    legacy: 'Canada’s wildfire story starts with this helplessness. Everything else on this page — the laws, the lookouts, the jumpers, the water bombers, the national desk — is what the country built so that no town would ever again face the forest alone. Two hundred years on, the fire was designated a National Historic Event of Canada.',
    facts: [
      { value: '12 of 260', label: 'Newcastle buildings left standing' },
      { value: '160–500', label: 'lives — never truly counted' },
      { value: '~1/5 of NB', label: 'forests in the burn estimates' },
    ],
    art: '/images/halloffame/miramichi-1825.webp',
  },
  {
    id: 'matheson-1916',
    year: '1916',
    title: 'The Great Matheson Fire · Ontario',
    body: "Settler land-clearing fires merged into one firestorm that consumed Matheson, Iroquois Falls and the towns between. It remains Canada's deadliest fire — and it forced the first modern forest-fire protection laws into being.",
    stat: '~223 lives',
    tone: 'warn',
    dateline: 'July 29, 1916 · the Great Clay Belt, northern Ontario',
    lede: 'Canada’s deadliest fire was not started by lightning. It was started by hope — hundreds of settler clearing fires, all burning into the same dry July.',
    story: [
      'Northern Ontario’s Great Clay Belt was sold as a promise: good farmland under the boreal forest, along the new Temiskaming & Northern Ontario Railway, free to anyone who would clear it. Fire was the only clearing tool a settler family had, and in the drought of July 1916 their slash fires had been burning for weeks up and down the line — legal, ordinary, and unattended.',
      'On July 29 a strong wind united them into a single conflagration advancing on a front reported at some 64 kilometres wide. Porquis Junction, Iroquois Falls, Kelso, Nushka, Matheson and Ramore were destroyed; Homer and Monteith were partially razed; a separate fire struck Cochrane the same day. In all, some 2,000 square kilometres burned.',
      'The village of Nushka suffered worst of all: 57 of its people died. Its parish priest, Father Wilfrid Gagné, was returning by train from a retreat when he saw the smoke and got off — against the conductor’s advice — to reach his parishioners. He led one group to shelter in a railway cut, went back into the burning village for a second, and died in the cut with them. The village was rebuilt and renamed Val Gagné, in his honour.',
      'Elsewhere people lived by inches: families stood for hours neck-deep in the Black River and the area’s small lakes, lay flat in ploughed fields, or crowded into root cellars and wells — which saved some and suffocated others as the fire stole the air above. And the railway that had carried the settlers in carried them out: T&NO trains ran through the burning bush, stopping to pull survivors aboard.',
      'The official toll was about 223 lives — still the deadliest fire in Canadian history. Nearly everyone who has studied it believes the real number is higher, perhaps by hundreds: the Clay Belt was full of unregistered homesteaders and prospectors no census had counted, and many of the dead could not be identified.',
      'It was the third town-killing fire in the region in five years — Porcupine had burned in 1911, and Haileybury would follow in 1922. Matheson was the one that finally broke the old way of doing things.',
    ],
    pull: 'The fire that killed 223 people was made of hundreds of small, legal, ordinary fires — every one of them somebody’s fresh start.',
    legacy: 'In 1917 Ontario passed the Forest Fires Prevention Act — burning permits, fire rangers, an organized provincial protection service. It was the first modern wildfire law in Canada, and it exists because of the people it came too late to save.',
    facts: [
      { value: '~223', label: 'the official toll — believed far higher' },
      { value: '~64 km', label: 'the width of the fire front' },
      { value: '1917', label: 'Ontario’s first fire-protection law' },
    ],
    art: '/images/halloffame/matheson-1916.webp',
  },
  {
    id: 'smokejumpers-1949',
    year: '1949',
    title: 'The Saskatchewan Smokejumpers',
    body: "Canada's first smokejumpers — a unit formed in 1947 — were flying out of La Ronge by 1949, parachuting into the boreal to catch fires while they were still small.",
    stat: 'Canada’s first',
    dateline: '1947–1967 · Prince Albert & La Ronge, northern Saskatchewan',
    lede: 'Before the helicopter, the fastest way to put a crew on a boreal fire was to throw them out of an airplane.',
    story: [
      'The mathematics of the north were brutal. A lookout tower or patrol aircraft could spot a smoke within hours of ignition — and then a ground crew would take days to reach it by truck, canoe and portage. By the time they arrived, a fire the size of a campfire had become a fire the size of a township.',
      'In June 1947 Saskatchewan’s Department of Natural Resources answered with something no Canadian agency had tried: smokejumpers. The first unit was eight men, average age twenty-five, selected under strict standards and trained at Prince Albert by a veteran of the 1st Canadian Parachute Battalion. By 1949 they had a permanent base at La Ronge, with a target of putting jumpers on a fire within about two hours of its report.',
      'The kit was as lean as the idea: a float-equipped Norseman bushplane, static-line parachutes out a freight door, two-man fire packs of saws, shovels, pulaskis, water bags and rations, and a twenty-eight-pound radio. Trainees practised landing rolls off moving trucks; over the muskeg, instructors tossed out rolls of toilet paper to read the wind before a jump; and every recruit learned the rope work for getting out of a parachute hung up in a spruce — a routine hazard of jumping into forest.',
      'The doctrine was initial attack, and it was a bet: most fires are killable in their first hours, by a handful of people with hand tools and a pump, if you can just get them there fast enough. Jump while the smoke is small, cut line, knock it down — then walk, paddle or fly off a nearby lake to get home.',
      'It worked. The unit grew to eight four-man teams and built a safety record it became known for — broken bones, but no one killed on operations. What retired it was not failure but a better aircraft: through the 1960s the helicopter arrived in the north, able to land a crew on any lakeshore without a parachute and sling their gear beneath it. By 1967 Saskatchewan’s jumpers stood down, their job handed to the machine that defines the fight to this day.',
    ],
    pull: 'The bet was simple: almost every fire is killable in its first hours — if you can just get people there.',
    legacy: 'Initial attack — hit fires fast, while they are small — is still the core doctrine of every wildfire agency in Canada. And the machine that replaced the parachute — the helicopter — has carried the fight over those same lakes ever since.',
    facts: [
      { value: '1947', label: 'Canada’s first jump unit formed' },
      { value: '~2 hours', label: 'smoke report to boots on the fire' },
      { value: '1967', label: 'stood down — the helicopter arrived' },
    ],
    art: '/images/halloffame/smokejumpers-1949.webp',
  },
  {
    id: 'chinchaga-1950',
    year: '1950',
    title: 'The Chinchaga firestorm · BC & Alberta',
    body: 'The largest single fire ever recorded in North America ran roughly 1.4 to 1.7 million hectares through the northern forest. Its "Great Smoke Pall" turned afternoon to dusk over Ontario and was traced as far as Europe.',
    stat: '~1.7M hectares',
    tone: 'fire',
    dateline: 'June–October 1950 · the Chinchaga River country, BC & Alberta',
    lede: 'The biggest fire ever recorded in North America was fought by almost no one — and witnessed, in a way, by half the world.',
    story: [
      'It began on June 1, 1950, after a dry spring, in the remote forest north of Fort St. John, British Columbia. Under the policy of the day it was left to burn: agencies were only required to suppress fires within about sixteen kilometres of settlements and major roads, and crews were stretched thin. A fire ranger asked permission to attack it with a ground crew while it was young; head office said no — it threatened nothing on the map.',
      'So it burned for nearly five months. Driven by wind after wind, the fire ran northeast across the provincial boundary deep into Alberta’s Chinchaga River country, until cool weather and rain — not suppression — ended it in late October. Estimates put the final burn at 1.4 to 1.7 million hectares: the largest single fire ever recorded in North America.',
      'In late September, the fire made itself known to the world. A great surge of burning lofted smoke high into the atmosphere, where the winds carried it east — and on September 24, over Ontario, the sun went out.',
      'The week is remembered as the Great Smoke Pall. Sarnia and Guelph sat through roughly three hours of midday darkness; Toronto’s light-sensitive streetlamps switched themselves on in the afternoon, and the city’s sudden surge of electricity tripped burglar alarms in the banks. Drivers crawled under headlights at noon. With Cold War nerves raw and no explanation at first, switchboards lit up with fears of nuclear attack, secret weapons tests, even invasion — before authorities traced the darkness to a forest fire three thousand kilometres away that almost no one had seen.',
      'Days later the pall crossed the Atlantic. It was observed over Scotland on September 27, then England, France, the Netherlands, Portugal and Denmark, where the high-altitude smoke turned the sun and moon blue — one of the best-documented blue-sun events ever recorded.',
      'No one is known to have died at Chinchaga. Hardly anyone fought it. It simply showed, on a continental scale, what the boreal forest can do when nothing stands between it and the wind.',
    ],
    pull: 'On September 24, 1950, the sun went out over Ontario at midday — and almost nobody knew it was a fire.',
    legacy: 'Chinchaga remains the benchmark for what a single boreal fire can be, and the starting point of a debate that never ended: which fires to fight, and which to let burn. Seventy years later its scale is no longer unimaginable — 2023 made sure of that.',
    facts: [
      { value: '1.4–1.7M ha', label: 'the largest single fire on record' },
      { value: '~3 hours', label: 'of midday darkness over Ontario' },
      { value: 'Blue sun', label: 'seen over Europe from its smoke' },
    ],
    art: '/images/halloffame/chinchaga-1950.webp',
  },
  {
    id: 'martin-mars-1960',
    year: '1960',
    title: 'The Martin Mars water bombers · British Columbia',
    body: 'Surplus wartime flying boats — the largest water bombers in the world — went to work over BC’s lakes. The last of them, Hawaii Mars, dropped some 190 million litres across five decades before its final flight in 2024, escorted by the Snowbirds.',
    stat: '190M litres dropped',
    dateline: '1959–2024 · Sproat Lake, Port Alberni, British Columbia',
    lede: 'When British Columbia’s timber companies wanted a bigger bucket, they bought the biggest flying boats ever put into service — out of a scrapyard — and taught them to drink lakes.',
    story: [
      'In 1959 the four surviving US Navy Martin JRM Mars flying boats — giants with sixty-metre wingspans, the largest flying boats ever to see operational service — had already been sold to a scrap dealer. Dan McIvor, chief pilot for the forest company MacMillan Bloedel, tracked them down and talked British Columbia’s timber industry into buying them: fire was eating the forests the industry lived on, so a consortium of companies — Forest Industries Flying Tankers — decided to buy its own air force.',
      'Converted in Victoria with a twenty-seven-thousand-litre tank and retractable scoops, and based at Sproat Lake near Port Alberni, they became the largest water bombers in the world. Skimming a lake at speed, a Mars could take more than 25,000 litres aboard in about twenty-two seconds, then lay it down across a swath of burning forest in a single pass — an order of magnitude beyond anything else flying.',
      'The work claimed its price early. In June 1961 the Marianas Mars crashed into a mountainside on Vancouver Island during firefighting operations, killing all four crew; accounts of the cause differ, and one witness account holds that the crew had just held back their drop after spotting people on the ground below. A year later Typhoon Freda tore the Caroline Mars from its steel moorings at Patricia Bay and threw it two hundred metres, breaking its back. Half the fleet was gone within three years of starting the job.',
      'The remaining two — Hawaii Mars and Philippine Mars — simply kept flying. From 1963 the red-and-white giants were a summer fixture over British Columbia for five decades, dropping on fires into the 2010s, by which point they were among the oldest working aircraft in the world. Across its career, Hawaii Mars alone put some 190 million litres of water onto BC’s fires.',
      'On August 11, 2024, Hawaii Mars lifted off Sproat Lake for the last time and flew a farewell circuit of Vancouver Island — past Comox, Campbell River, Nanaimo and Victoria, joined by all nine Canadian Forces Snowbirds — while thousands of people lined the shorelines below to watch the last of the giants come home to the British Columbia Aviation Museum.',
    ],
    pull: 'Half the fleet was lost within three years — and the other half flew for fifty more.',
    legacy: 'The Mars proved the idea the whole aerial fight is built on: in lake country, the water is already there — you just need an aircraft willing to go down and get it, again and again, until the fire gives up.',
    facts: [
      { value: '25,000+ L', label: 'aboard in a ~22-second skim' },
      { value: '~190M litres', label: 'Hawaii Mars’ career total' },
      { value: '2024', label: 'the final flight, nine Snowbirds up' },
    ],
    art: '/images/halloffame/martin-mars-1960.webp',
  },
  {
    id: 'cl215-1967',
    year: '1967',
    title: 'Canada builds the water bomber · Canadair CL-215',
    body: 'The first aircraft in the world designed from a clean sheet to fight fire flew out of Quebec. 125 were built for 11 countries, and its scooper descendants still skim lakes from Canada to southern Europe.',
    stat: '125 built · 11 nations',
    dateline: 'First flight October 23, 1967 · Cartierville Airport, Montreal',
    lede: 'Every firefighting aircraft before it had been something else first — a bomber, a patrol plane, a flying boat. In 1967 Canada built the first one born for the job.',
    story: [
      'Through the 1950s and 60s, aerial firefighting flew on hand-me-downs: retired warbirds and converted transports, each drop ending with a long flight back to a distant airbase to reload. Quebec — a province that is mostly forest and water — wanted an aircraft designed for its actual geography, and its government believed in the idea enough to order fifteen of them before the prototype had ever flown, to replace its fleet of war-surplus Canso flying boats.',
      'Canadair’s answer was the CL-215: a tough, deliberately simple amphibian drawn from a clean sheet of paper for one purpose — by every standard account, the first aircraft in the world purpose-designed for firefighting. The prototype lifted off from Cartierville Airport in Montreal on the morning of October 23, 1967, with Canadair’s chief test pilot Bill Longhurst at the controls.',
      'The idea was the scoop. Instead of returning to base, the CL-215 lands on the nearest lake or river at speed, skims for about twelve seconds, and lifts off with some 5,400 litres aboard. With water nearby, one aircraft cycles continuously — drop, scoop, drop — putting more water on a fire in an afternoon than far larger aircraft flying round trips to a tanker base.',
      'The first delivery went to France’s civil-protection service in June 1969, with Quebec’s own fleet close behind, and the type spread wherever forest meets water: 125 were built between 1969 and 1990, serving eleven countries, from Canada’s provinces to Spain and Greece. The sight of a yellow-and-red scooper skimming a lake became the international shorthand for fighting fire from the air.',
      'Its lineage never ended. The turboprop CL-415 followed in 1993, and the family is in production again today as the De Havilland Canada DHC-515 — with the first twenty-two aircraft spoken for by six European countries whose fire seasons now look like Canada’s.',
    ],
    pull: 'The breakthrough wasn’t size or speed. It was refusing to fly home between drops.',
    legacy: 'Canada gave the world the water bomber — and the scooper’s loop of lake, fire, lake is still how the fight is flown, one load at a time.',
    facts: [
      { value: 'Oct 23, 1967', label: 'first flight, Montreal' },
      { value: '~5,400 L', label: 'scooped in a 12-second skim' },
      { value: '125 · 11', label: 'built · nations served' },
    ],
    art: '/images/halloffame/cl215-1967.webp',
  },
  {
    id: 'ciffc-1982',
    year: '1982',
    title: 'Canada learns to fight as one · CIFFC',
    body: "After three brutal seasons, the agencies founded the Canadian Interagency Forest Fire Centre — the desk that moves crews, pumps and airtankers to whichever province is burning worst. The same agency whose live data feeds this site's map.",
    stat: 'One national effort',
    dateline: 'Founded June 2, 1982 · Winnipeg, Manitoba',
    lede: 'The most important firefighting tool Canada ever built does not fly, pump or dig. It is a desk in Winnipeg that knows where everything is.',
    story: [
      'Wildfire in Canada is fought by the provinces and territories — thirteen agencies, thirteen borders. The weakness was obvious every bad year: one province would be overwhelmed, burning through crews and airtankers, while its neighbour’s resources sat ready under a quiet sky — with no machinery to move them.',
      'The fire seasons of 1979 through 1981 ran the country critically short of resources three years in a row, and made the case undeniable. On June 2, 1982, the federal, provincial and territorial governments founded the Canadian Interagency Forest Fire Centre — CIFFC — in Winnipeg, as the country’s shared dispatch desk.',
      'Its job is logistics at national scale, and nothing commands anyone: CIFFC coordinates. Every day of the season it assembles the National Situation Report — every fire, every agency’s posture — sets the National Preparedness Level, and brokers the movement of whatever the worst-hit province needs under the mutual-aid resource-sharing agreement its members signed: twenty-person crews, airtankers, helicopters, pumps, hose, overhead teams.',
      'Mutual aid became routine. A Nova Scotia crew cutting line in British Columbia, an Ontario airtanker working Alberta’s flank — by August of a bad year, that is simply how Canada fights.',
      'Then the desk went international: agreements with the United States, Australia, New Zealand, South Africa, Mexico and Costa Rica — and, in the crucible of 2023, new arrangements with France, Spain, Portugal, Chile, Brazil and South Korea. When the record season came, help from twelve countries on six continents arrived through the system built in 1982, while the centre held the country at its maximum preparedness level for 120 consecutive days.',
      'And it is not history — the live numbers on this site’s front door and map, the count of fires burning across Canada right now, come from CIFFC’s national situation reporting.',
    ],
    pull: 'A Nova Scotia crew on a British Columbia fireline isn’t an emergency improvisation. Since 1982, it’s the design.',
    legacy: 'CIFFC turned thirteen separate fights into one national effort — and forty years later, into a global one. Its live data is the honest window this site opens onto every fire burning in Canada today.',
    facts: [
      { value: 'June 1982', label: 'founded in Winnipeg' },
      { value: '13 agencies', label: 'one shared national desk' },
      { value: 'Live', label: 'its data feeds this site’s map' },
    ],
    art: '/images/halloffame/ciffc-1982.webp',
  },
  {
    id: 'okanagan-2003',
    year: '2003',
    title: 'The Okanagan Mountain Park firestorm · Kelowna, BC',
    body: 'A lightning strike became a firestorm on Kelowna’s doorstep: 27,000 people evacuated and 239 homes lost. More than a thousand wildland firefighters and 1,400 Canadian Forces troops stood the line in the streets.',
    stat: '27,000 evacuated',
    tone: 'warn',
    dateline: 'August 2003 · Okanagan Mountain Provincial Park & Kelowna, British Columbia',
    lede: 'One lightning strike in a tinder-dry park became the night Canadians learned that wildfire could walk into a modern city.',
    story: [
      'Around four in the morning on August 16, 2003 — in the driest summer British Columbia had measured to that point — lightning struck in Okanagan Mountain Provincial Park, on the slopes above Okanagan Lake just south of Kelowna. It was spotted quickly. It did not matter: the terrain was steep, the fuel was cured, and the fire grew against everything thrown at it, walking the parkland toward the city.',
      'On the night of August 21–22 the wind turned it into a firestorm. Crews on the Mission slopes described a wall of flame on the order of a hundred metres high coming off the park, throwing embers over the guard and into Kelowna’s southern neighbourhoods. In that single night, 224 homes were lost.',
      'Some 27,000 people were evacuated — sources count as many as 30,000 — while roughly sixty fire departments from across the province converged on one city, alongside about a thousand BC forest firefighters and 1,400 Canadian Forces troops of Operation Peregrine. One Kelowna crew was cut off by the fire that night and presumed lost; they had retreated to open ground and sheltered under their trucks, and every one of them walked out.',
      'By the end, 239 homes were gone — and thousands more were still standing because someone had stayed between them and the fire. The fire also took a piece of history: twelve of the eighteen great wooden railway trestles of Myra Canyon, on the century-old Kettle Valley Railway, burned in the same run. Volunteers who had spent a decade restoring them watched them burn — then rebuilt them, plank by plank in Douglas fir, until the canyon reopened in 2008.',
      'The summer exacted a price from the air: three pilots died fighting British Columbia’s fires in 2003 — two in an airtanker that went down near Cranbrook in July, one in a helicopter on a fire north of Kamloops in August. The record honours them together.',
      'No resident of Kelowna died in the flames. That fact is not luck — it is the line, holding.',
    ],
    pull: '239 homes burned. Thousands more stood because someone stayed between them and the fire.',
    legacy: 'The provincial review that followed — Firestorm 2003 — rewrote how British Columbia, and then Canada, faces fire where forest meets city: community wildfire protection plans, interface fuel treatment, FireSmart. Every community fire plan in the country carries Kelowna’s lessons.',
    facts: [
      { value: '239 homes', label: '224 of them in one night' },
      { value: '~60', label: 'fire departments converged' },
      { value: '0', label: 'residents lost to the flames' },
    ],
    art: '/images/halloffame/okanagan-2003.webp',
  },
  {
    id: 'fort-mcmurray-2016',
    year: '2016',
    title: 'Fort McMurray — "The Beast" · Alberta',
    body: 'A fire so fierce it made its own weather sent 88,000 people down one highway through the flames. Firefighters held the hospital, the downtown and most of the city while the costliest disaster in Canadian history burned around them.',
    stat: '88,000 evacuated',
    tone: 'warn',
    dateline: 'May 2016 · Fort McMurray, Alberta',
    lede: 'It made its own lightning, outran every forecast, and emptied a city of 88,000 in a single day — and not one person was lost to the flames.',
    story: [
      'A helicopter forestry crew spotted the fire on May 1, 2016, in the bush southwest of Fort McMurray, and for a day it looked like a fire the city would watch, not flee. On May 3 the wind shifted. By afternoon the fire had crossed every barrier thought to protect the city and was burning into neighbourhoods; at 6:49 p.m. the entire city was ordered out.',
      'What followed was the largest wildfire evacuation in Canadian history: roughly 88,000 people, almost all of them down one road — Highway 63 — driving through smoke and past walls of flame. Some 25,000 who fled north to the oil-sands work camps were later brought back south in RCMP-marshalled convoys of fifty vehicles at a time, police cruisers front and rear, helicopters overhead, getting their first sight of their burned city through the windshield.',
      'Behind them, firefighters fought for the city and largely won. Whole streets were lost — about 2,400 structures in all — but the line held at the hospital, the downtown, the water-treatment plant and every school but one. Some 85 to 90 percent of Fort McMurray was still standing when the smoke cleared.',
      'No one died in the fire itself. Two young evacuees — one of them the teenage daughter of a Fort McMurray fire captain, who was fighting the fire as she fled — died in a highway collision during the evacuation: the disaster’s human toll, and a reminder that the escape was its own ordeal.',
      'The fire’s behaviour rewrote the textbooks. It built pyrocumulonimbus storm clouds — fire-driven thunderheads — whose lightning ignited new fires as much as forty kilometres ahead of the main front. The regional fire chief, Darby Allen, took to speaking of it as a living thing, ferocious and unpredictable, and his name for it stuck: the Beast.',
      'It burned on long after the cameras left — across nearly 590,000 hectares and over the Saskatchewan boundary — and was not declared fully extinguished until August 2, 2017, more than fifteen months after it started. With insured losses near $3.7 billion, it stands as the costliest disaster in Canadian history.',
    ],
    pull: 'The save is measured in what stood: the hospital, the downtown, ninety percent of a city — held by people who stayed while 88,000 drove out.',
    legacy: 'Fort McMurray proved that a modern Canadian city can be evacuated, defended and rebuilt through the worst fire ever to enter one. "The Beast" became the reference point every interface fire since has been measured against.',
    facts: [
      { value: '88,000', label: 'evacuated · none lost to the fire' },
      { value: '~40 km', label: 'ahead — its own lightning lit fires' },
      { value: '~$3.7B', label: 'insured · Canada’s costliest disaster' },
    ],
    art: '/images/halloffame/fort-mcmurray-2016.webp',
  },
  {
    id: 'season-2023',
    year: '2023',
    title: 'The year the world came to help',
    body: 'The worst season ever recorded: more than 18 million hectares burned, Yellowknife emptied, and BC’s largest-ever fire at Donnie Creek. Over 5,500 firefighters from a dozen countries flew in to stand beside Canada’s own.',
    stat: '12 nations answered',
    dateline: 'May–October 2023 · every province and territory of Canada',
    lede: 'There had never been a season like it — fires from the Atlantic suburbs to the Arctic, a burn well over double the old record — and for the first time at such scale, the whole world flew in.',
    story: [
      'It started early, and it started everywhere. May brought fires across Alberta and — almost unthinkably — into the suburbs of Halifax. June lightning lit hundreds of fires across Quebec, and the smoke poured south until New York City’s sky turned orange and its air, for a day, was the worst of any major city on Earth. The old national record for a full season was broken by June 27. Fires burned in every province and territory.',
      'The official tally closed at some 18.4 million hectares — roughly two and a half times the previous record, and six or seven times an average year. The national preparedness level sat pinned at its maximum for 120 consecutive days, and more than 200,000 Canadians were forced from their homes over the season.',
      'In August it came for a capital. Yellowknife — some 20,000 people, nearly half the population of the Northwest Territories — was ordered out and emptied in roughly 48 hours, down the territory’s single highway, 1,500 kilometres to Edmonton, and by an airlift whose queues ran twelve hours long, while crews cut firebreaks to hold the city’s edge. In British Columbia, the Donnie Creek fire grew to 619,000 hectares — larger than Prince Edward Island, the largest fire in the province’s recorded history.',
      'Canada’s own crews could not be everywhere, and through CIFFC’s agreements the world answered: more than 5,500 firefighters from twelve countries on six continents worked Canadian firelines that summer — the Americans, Australians and New Zealanders of old agreements, and first-time contingents from France, Spain, Portugal, Chile, Brazil and South Korea. When two hundred South African firefighters landed in Edmonton, they came through arrivals singing; their crew leader told reporters, "When we sing like this, we know that we are connected. We are one."',
      'The season took eight of Canada’s own, all in the line of duty: a 19-year-old struck by a falling tree near her hometown of Revelstoke, found by her own crewmates; a 25-year-old defending his home community at Fort Liard; a helicopter pilot lost bucketing in Alberta; a contractor on the Donnie Creek fire; and four more crew members killed on the highway driving home from the fire line. Their loss sits under every statistic in this record.',
      'When the snow finally ended it, 2023 had redrawn the map of what a fire season can be — and shown, at the same time, the full reach of the system Canada had spent two centuries building: laws, doctrine, aircraft, a national desk, and friends.',
    ],
    pull: 'Eight of Canada’s own did not come home that season. Every number in this record sits under that fact.',
    legacy: '2023 redrew the map of what a fire season can be. The line still held — because of the people who hold it, at home and from the twelve nations who crossed oceans to stand beside them.',
    facts: [
      { value: '18.4M ha', label: 'official — ~2.5× the old record' },
      { value: '5,500+', label: 'firefighters from 12 nations' },
      { value: '8', label: 'of Canada’s own lost that season' },
    ],
    art: '/images/halloffame/season-2023.webp',
  },
  {
    id: 'season-2025',
    year: '2025',
    title: 'The fires come home · Saskatchewan & Manitoba',
    body: "The second-worst season on record hit the prairie provinces hardest: Manitoba declared two provincewide emergencies, more than 85,000 people fled — over half of them from First Nations — and the fire walked into the La Ronge lake country itself.",
    stat: '85,000+ evacuated',
    tone: 'warn',
    dateline: 'May–October 2025 · Manitoba, Saskatchewan & the boreal north',
    lede: 'Two years after the record book burned, the fires came back — for the prairie provinces, for the fly-in north, and for the La Ronge lake country itself.',
    story: [
      'If 2023 could be filed as a freak, 2025 ended the argument. More than 8.3 million hectares burned — federal year-end mapping puts it near nine million — making it the second-worst season ever recorded, behind only 2023 and roughly double the ten-year average. And this time the epicentre was the middle of the country: Manitoba and Saskatchewan together accounted for about half the national burn, and Manitoba had the worst fire year in its modern record.',
      'Manitoba declared a provincewide state of emergency twice in one season. The first came on May 28, as Flin Flon — some 4,800 people — emptied for nearly a month, alongside Pimicikamak and Pukatawagan. The second came on July 10, when fire entered Garden Hill Anisininew Nation, a fly-in First Nation of four thousand, and Canadian Forces Hercules transports shuttled its residents out to Winnipeg.',
      'Across the season more than 85,000 Canadians were forced from their homes — over 45,000 of them from 73 First Nations communities, which bore more than half of all the displacement. The season’s human toll fell in its first weeks: a couple trapped by the Lac du Bonnet fire in Manitoba in mid-May died before crews, held back by extreme fire behaviour, could reach them.',
      'Then it came for La Ronge. On June 2 the Pisew fire — already some 84,000 hectares — breached the La Ronge airport, and La Ronge, Air Ronge and the Lac La Ronge Indian Band communities — about 7,500 people — were ordered out. The band lost homes at Sucker River and Hall Lake. The Robertson Trading Post — the fur-trade landmark that had anchored La Ronge since 1967 — burned with hundreds of pieces of Indigenous art inside; its co-owner made it back through the smoke just in time to watch it go.',
      'The same week, the Wolf fire took roughly 230 homes — about half the village — at Denare Beach in a single day, the worst of some 400 structures lost across Saskatchewan’s hardest season in decades; by June 3, thirty-three Saskatchewan communities were under evacuation at once. About 1,500 firefighters from six countries — the United States, Mexico, Australia, New Zealand, Costa Rica and Chile — flew in to help, while the smoke gave Minnesota its longest air-quality alert on record and crossed the Atlantic to Europe by mid-May.',
      'When it ended, the arithmetic was impossible to ignore: two of the three worst seasons ever recorded had happened within three years. Officials stopped calling it exceptional and started calling it the pattern — and a full year later, some Denare Beach families were still not home.',
    ],
    pull: 'La Ronge, Air Ronge, Denare Beach — in 2025 the lake country itself burned.',
    legacy: '2025 ended any argument that 2023 was an outlier. To the crews who held La Ronge’s edge, the pilots who flew a town out of Garden Hill, and the thousands still rebuilding — this page is for you.',
    facts: [
      { value: '2nd worst', label: 'season on record — after 2023' },
      { value: '85,000+', label: 'evacuated · half from First Nations' },
      { value: 'La Ronge', label: 'evacuated · ~7,500 people' },
    ],
    art: '/images/halloffame/season-2025.webp',
  },
];

/** Story-page lookup. */
export function eventById(id: string | null | undefined): HofEvent | undefined {
  return id ? EVENTS.find((e) => e.id === id) : undefined;
}

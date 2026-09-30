// The people of Hollowmere. Each has a voice; what they *say* is assembled from what the world has done.
// Anchors are building-local (x, z) with +z = toward the door.

export const ROSTER = [
  {
    id: 'n_nova', name: 'Nova Kell', role: 'Night DJ', home: 'b_sable', work: 'b_radio', workAt: [0, -1.4], homeAt: [-1.2, 0.6], arch: 'nova', voice: 1.25,
    look: { skin: '#c99a7c', hair: '#2a1f3d', style: 'long', shirt: '#5a2d7a', pants: '#1c1c28', hat: 'headphones', glasses: false, scale: 0.98, build: 0.92 },
  },
  {
    id: 'n_bet', name: 'Bettina Marrow', role: 'Cook', home: 'b_whitlock', work: 'b_diner', workAt: [0, -2.5], homeAt: [-1, 1], arch: 'bet', voice: 1.05,
    look: { skin: '#e2b799', hair: '#7a3b2a', style: 'bun', shirt: '#f2efe6', pants: '#3a3a44', hat: 'none', glasses: false, scale: 0.97, build: 1.15 },
  },
  {
    id: 'n_dutch', name: 'Dutch Okonkwo', role: 'Mechanic', home: 'b_okafor', work: 'b_garage', workAt: [-4.2, -2.4], homeAt: [1, 1], arch: 'dutch', voice: 0.72,
    look: { skin: '#6b4630', hair: '#141414', style: 'bald', shirt: '#2d4a7a', pants: '#3b3226', hat: 'cap', glasses: false, scale: 1.07, build: 1.2 },
  },
  {
    id: 'n_ada', name: 'Ada Lund', role: 'Shopkeeper', home: 'b_lund', work: 'b_store', workAt: [2.6, 0.1], homeAt: [-0.5, 0.8], arch: 'ada', voice: 1.12,
    look: { skin: '#f0cfb5', hair: '#b9b9c2', style: 'bun', shirt: '#7a2d3c', pants: '#2b2b33', hat: 'none', glasses: true, scale: 0.92, build: 0.95 },
  },
  {
    id: 'n_reyes', name: 'Sheriff Reyes', role: 'Sheriff', home: 'b_constab', work: 'b_constab', workAt: [0, -1.4], homeAt: [-3.5, -1.0], arch: 'reyes', voice: 0.85,
    look: { skin: '#a8734f', hair: '#1d1512', style: 'short', shirt: '#4a5a3a', pants: '#2a3020', hat: 'sheriff', glasses: false, scale: 1.06, build: 1.1 },
  },
  {
    id: 'n_anselm', name: 'Father Anselm', role: 'Priest', home: 'b_chapel', work: 'b_chapel', workAt: [-1.7, -4.7], homeAt: [-2.4, -5.2], arch: 'anselm', voice: 0.9,
    look: { skin: '#d8b596', hair: '#8a8a8a', style: 'bald', shirt: '#151515', pants: '#151515', hat: 'none', glasses: true, scale: 1.0, build: 0.9 },
  },
  {
    id: 'n_piet', name: 'Old Piet', role: 'Fisherman', home: 'b_boathouse', work: null, workAt: null, homeAt: [0, 0.5], arch: 'piet', voice: 0.78, spot: { x: 10, z: -25.5 },
    look: { skin: '#b98a68', hair: '#d0d0d0', style: 'wild', shirt: '#4d6a4a', pants: '#3a3628', hat: 'beanie', glasses: false, scale: 0.94, build: 1.0 },
  },
  {
    id: 'n_junie', name: 'Junie Brandt', role: 'Kid', home: 'b_brandt', work: null, workAt: null, homeAt: [1, 1], arch: 'junie', voice: 1.6, kid: true,
    look: { skin: '#e8c3a4', hair: '#d99a2b', style: 'short', shirt: '#d94c3d', pants: '#375a8a', hat: 'none', glasses: false, scale: 0.68, build: 0.9 },
  },
  {
    id: 'n_marguerite', name: 'Marguerite Corvin', role: 'Innkeeper', home: 'b_corvin', work: 'b_inn', workAt: [4.5, -3.6], homeAt: [0, 0.8], arch: 'marg', voice: 0.98,
    look: { skin: '#f0d3bd', hair: '#4a1f3a', style: 'short', shirt: '#3f5a6a', pants: '#2a2a34', hat: 'none', glasses: false, scale: 0.99, build: 1.0 },
  },
  {
    id: 'n_wren', name: 'Wren', role: 'Drifter', home: null, work: null, workAt: null, homeAt: null, arch: 'wren', voice: 1.32, spot: { x: 8, z: 22 },
    look: { skin: '#c48f6e', hair: '#3b2a1d', style: 'wild', shirt: '#6a5b3a', pants: '#42402f', hat: 'hood', glasses: false, scale: 0.96, build: 0.85 },
  },
  {
    id: 'n_okafor', name: 'Dr. Ilse Okafor', role: 'Doctor', home: 'b_okafor', work: null, workAt: null, homeAt: [-2, -1.2], arch: 'doc', voice: 1.0, spot: { x: -20, z: 50 },
    look: { skin: '#7a5238', hair: '#1a1a1a', style: 'bun', shirt: '#e8eef2', pants: '#2c3a4a', hat: 'none', glasses: true, scale: 1.0, build: 0.95 },
  },
];

// ---- speech ----
// opener: prepended to news. idle: personal lines. hint: clues about the Understory. others as named.
export const VOICES = {
  nova: {
    openers: ['Listen close —', 'Off the record —', 'Signal check —', 'Between songs —'],
    idle: ["I get callers who aren't on the phone.", "The dead air here isn't empty. It's *busy*.", "Every night at the same minute, the carrier wave hiccups. As if someone blinks.", "Somebody out there is running this place. I've stopped saying 'something'.", "I play requests. Some requests come from people I buried."],
    hint: ["The static bends toward Saint Anselm's. Same bearing, every night.", "Something under the town hums at 40 hertz. Church-ward. Go listen to the floor."],
    greet: ['You made it. Sit — the signal loves company.', 'New voice. Good. The old ones repeat themselves.'],
    thanks: ["You're a strange kind of kind. I'll play you a song."], fear: ["Turn it off. Turn the sky off—"], angry: ["You. You're on my list now. My *listener* list. It's not friendly."],
  },
  bet: {
    openers: ['Oh, honey —', 'Sit down, sit down —', 'You hear this? —', 'Lord —'],
    idle: ['Coffee is always on. That is the only law I obey.', 'Been feeding this town twenty years. It never once said thank you. You did. Sit.', 'The lake looks different lately. Like it is thinking.', 'Whoever runs this place keeps the diner open. I respect that.', "I don't ask what people did. I ask what they want on the eggs."],
    hint: ['My grandmother swore the old town went *down*, not away. I never asked how.', "There's a draft in the cellar that comes from nowhere. Smells like stone and candle."],
    greet: ["Well look at you. You eat? You don't look like you eat."], thanks: ['Oh! Oh, you didn’t have to. Sit. Pie. Now.'], fear: ["Don't! Please — I have a stove!"], angry: ["Out of my diner. You know why."],
  },
  dutch: {
    openers: ['Look —', 'Not my business, but —', 'Straight up —', 'Listen, friend —'],
    idle: ['Everything breaks. That is the only honest fact about machines. Also people.', 'Fuel drums are the best and worst invention. Do not throw them.', 'I fix things. The server fixes me. Nobody asked.', 'Truck in the corner ran on the day I got here. It has not since. It *chose*.'],
    hint: ['The floor plate under the church rug is not original. I know welds.', 'Old blueprints show a second town. Stacked. Somebody scratched over them.'],
    greet: ['Hands where I can see them. Kidding. Mostly.'], thanks: ["Huh. Solid. I owe you a wrench."], fear: ["Easy! EASY!"], angry: ["I know what you broke. Stay away from my garage."],
  },
  ada: {
    openers: ['Mm. Well —', 'Mark my words —', 'I do keep records, dear —', 'Between you and the till —'],
    idle: ["I've sold this town the same nails for forty years. They keep needing them.", "Prices go up when the sky changes. I don't make the rules.", 'Somebody moved my shelf last night. Not a person. The shelf *moved*.', 'Everything has a ledger, dear. Even the lake.'],
    hint: ["Anselm bought forty candles a week and burned none upstairs. Where do they go?"],
    greet: ['Welcome to Pell’s. Everything is for sale except my opinion.'], thanks: ['Well. That’s... unexpected. Take a peppermint.'], fear: ['The till! Take the till!'], angry: ["I have written your name down. In ink."],
  },
  reyes: {
    openers: ['Official word —', 'For the record —', 'Citizen —', 'Off the clock —'],
    idle: ['I keep the peace. Someone keeps the *world*. We do not meet.', 'Every crime here is witnessed. I just have not worked out by whom.', 'Two years, no arrests. The server does not need me. I stay for the coffee.', 'People say the sky answers to them. Sky answers to nobody. Nobody I have cuffed.'],
    hint: ['Complaints of humming at Saint Anselm’s. I filed it under "weather".'],
    greet: ['Evening. Behave, or I’ll be forced to be interesting.'], thanks: ['Noted. Favorably.'], fear: ['Everybody stay calm! Especially me!'], angry: ['You are under a citizen’s suspicion. Which is worse than an arrest.'],
  },
  anselm: {
    openers: ['My child —', 'Forgive the interruption —', 'The floor was trembling —', 'Peace —'],
    idle: ['The bell rings itself sometimes. I have stopped being alarmed and started being curious.', 'I pray to whoever is listening. The server listens back. That must count.', 'Every prayer here gets an answer. That is the frightening part.', 'The rug is crooked again. I straighten it. It is crooked again.'],
    hint: ['If you must know: I have never lifted that rug. I am afraid of what is under.', 'Something beneath the altar keeps a lamp lit. I hear the oil.'],
    greet: ['Welcome. Mind the rug.'], thanks: ['God bless you. Or whoever governs here.'], fear: ['Lord above, or below —'], angry: ['You defiled something. Not the building. The *agreement*.'],
  },
  piet: {
    openers: ['Lake says —', 'Fish told me —', 'Heard it in the water —', 'Aye —'],
    idle: ["Water's been colder since the last stone. Thirteen days by my count. Or thirteen minutes.", 'Things go into the lake. Some come back. Never the same.', 'Caught a fish with a wristwatch in it. Time was correct. Nobody wears watches here.', "Lake's got moods. I read 'em like a barometer."],
    hint: ['Went fishing at the north shore, hooked a *lamp*. On a chain. Chain went down further than the lake does.'],
    greet: ["Sit on the pier if ye like. Don't drop nothing you'll miss."], thanks: ['That’s a good gift. Lake’ll hear about it.'], fear: ['The water! Get to the water!'], angry: ['You threw the wrong thing in the wrong place.'],
  },
  junie: {
    openers: ['Whoa, guess what —', 'Nobody believes me but —', 'I SAW it —', 'Psst —'],
    idle: ['I keep a list of everything the sky does. Page six is *full*.', 'The gnome moves at night. I have proof. Well, evidence. Well, a feeling.', 'Do you know who runs the server? I say it’s a giant. Dad says it’s a committee.', 'I tried to dig to the middle of the earth. I found a candle.'],
    hint: ['Under the church there is a whole other TOWN. I heard it. It has a *bus stop*.'],
    greet: ['Are you real? Like — a player? Cool. Cool cool cool.'], thanks: ['WOW! Best day ever!'], fear: ['AAAAH!'], angry: ['You’re a bad person. I wrote it down.'],
  },
  marg: {
    openers: ['Guests keep saying —', 'Mind you —', 'Under this roof —', 'Darling —'],
    idle: ['Room six is never empty and never booked. I no longer knock.', 'The Inn has hosted a thousand travelers. Every last one left through the front door. Eventually.', 'I keep a lamp lit for anyone still walking in. There’s always someone still walking in.', 'Check-out is whenever the server says it is.'],
    hint: ['A guest once asked me for the way *down*. Not the cellar. *Down*. I sent them to Anselm.'],
    greet: ['Welcome to the Hollow Inn. Vacancy: always.'], thanks: ['How generous. Have the good room.'], fear: ['Not the Inn — please!'], angry: ['Leave. You are not a guest. You are a *weather event*.'],
  },
  wren: {
    openers: ['Wind says —', 'Pass it on —', 'Word from the road —', 'Hey. Hey. —'],
    idle: ['I was here before the town. Or after. Time works differently on the road.', 'Everybody thinks the world is fixed. It is *drafted*.', 'The map I carry changes. I did not change it.', 'I walk where players walk. That is where the ground learns to be a road.'],
    hint: ['Follow the worn paths. They point where people *want* to go — and under is where they end up.'],
    greet: ['Another walker. Good. Roads need feet.'], thanks: ['Kind. Rare. I will remember.'], fear: ['Run! It sees us!'], angry: ['I follow roads. Yours ends badly.'],
  },
  doc: {
    openers: ['Clinically —', 'As a doctor —', 'Purely medically —', 'Between patients —'],
    idle: ['Nobody in Hollowmere gets sick. They get *edited*.', 'I once treated a man for dying. He recovered on schedule. It was the strangest chart I have kept.', 'Explosions are the third most common cause of my working day.', 'I keep a folder of patients who will never come in again. It grows quickly now.'],
    hint: ['A patient described a city under the town, with real weather. He was calm. That worried me more.'],
    greet: ['Take a breath. Any breath. Good. You are alive.'], thanks: ['That is generous. Doctor’s orders: repeat.'], fear: ['Everybody down!'], angry: ['You have made my job worse. Deliberately.'],
  },
};

export const NEWS = {
  destroyed: [
    '{actor} brought down {building}. Down to the foundation.',
    '{building} is gone. {actor} did that, I swear.',
    'Someone put charges under {building}. Folks say {actor}.',
    'You hear the boom? That was {building}. That was {actor}.',
  ],
  killed: [
    '{victim} is dead. {actor} was standing right there.',
    'They say {actor} killed {victim}. In *Hollowmere*. Imagine.',
    'We lost {victim}. Permanently. The server does not do reruns.',
  ],
  offering: [
    '{actor} threw {item} into the lake. The lake has not said thank you. Yet.',
    'The lake accepted {item} from {actor}. It keeps a list, you know.',
  ],
  event: [
    'The server did it again — "{title}".',
    'You feel that? "{title}". The whole valley heard.',
    'Another one: "{title}". Nobody claims it.',
  ],
  died: [
    '{actor} died — {cause}. The server remembers.',
    'Poor {actor}. {cause}. Do not follow their example.',
  ],
  discovery: [
    '{actor} found something under the chapel. They will not say what.',
    'There is a city under the town. {actor} went down and came back different.',
  ],
  plank: ['Someone keeps laying planks across the water. {actor}, I think. Brave. Or bored.'],
  sign: ['New sign by {place}: "{text}". Somebody has opinions.'],
  vanish: ['The {place} is *gone*. Not destroyed. Un-made.'],
  moved: ['They moved {building}. Nobody moved it. It moved.'],
  prophecy: ['The billboard had {actor}\'s name on it before {actor} ever arrived.'],
};

export const CALMING = ['Just the wind.', 'It will pass.', 'Nothing to see.', 'Breathe.'];

export const BARKS = {
  scared: ['GET DOWN!', 'Not again!', 'Run!', 'What was THAT?!', 'Take cover!'],
  hurt: ['Ow!', 'Aagh!', 'Why —!', 'Stop!'],
  mourn: ['Oh no…', 'It was right there…', 'Gone. Just gone.', 'I liked that place.'],
  relief: ['Is it over?', 'Okay… okay.', 'Anyone hurt?'],
  wave: ['Hey there!', 'Evening.', 'Hello, traveler.'],
  night: ['Late to be out.', 'Something is watching tonight.', 'Stars look wrong.'],
  storm: ['Storm’s here.', 'That thunder was close.', 'Mind the lightning.'],
};

export const NEW_ROLES = ['Traveler', 'Surveyor', 'Salvager', 'Pilgrim', 'Photographer', 'Locksmith', 'Radio Ham', 'Beekeeper'];
export const LOOKS = {
  skins: ['#f0cfb5', '#e2b799', '#c99a7c', '#b98a68', '#8a5b3c', '#6b4630', '#4f3323'],
  hairs: ['#141414', '#2a1f3d', '#4b2f1a', '#7a3b2a', '#b9b9c2', '#d99a2b', '#8a8a8a'],
  shirts: ['#3a5a7a', '#7a3c3c', '#4a6a3a', '#7a6a3a', '#5a3a6a', '#2a2a2a', '#c9c1a8', '#a94f2a'],
  pants: ['#2a2a33', '#3b3226', '#2b3a4a', '#42402f', '#1c1c28'],
  styles: ['short', 'long', 'bun', 'wild', 'bald'],
  hats: ['none', 'none', 'cap', 'beanie', 'hood'],
};

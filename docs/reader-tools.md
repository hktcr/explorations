# Gemensamma läsverktyg

`reader-settings.js` och `reader-settings.css` är den enda gemensamma implementationen
av läsverktygen för alla publicerade essäer.

Lagret ger samma funktioner oavsett essämall:

- sökning utan att skriva om artikelns innehåll när webbläsaren stöder Highlight API
- teckenstorlek från 80 till 150 procent
- serif eller sans serif
- radbredd från 48 till 110 tecken
- automatiskt, ljust eller mörkt tema
- utskrift och läsprogression
- ljudkontroller endast när en verklig `narration.mp3` finns
- sparade inställningar mellan essäer
- tangentbord, pekskärm, hög kontrast och minskad rörelse

Kommentarer och reflektioner ligger kvar i det separata lagret `engagement/`.

## När en essä skapas eller ändras

Kör:

```sh
node scripts/inject-reader-settings.cjs
python3 scripts/build_search_index.py
node scripts/validate-network.cjs
node --test
```

Injiceringsskriptet hämtar automatiskt alla essävägar från `index.html`, tar bort äldre
referenser till läsarlagret och lägger tillbaka exakt en versionsmärkt CSS- och
JavaScript-referens. Testet `tests/reader-settings.test.js` kontrollerar att varje
publicerad essä använder samma lager och att den gemensamma funktionsuppsättningen
finns kvar.

## Fokusprogress och läsmusik (2026-09-22)

Fokuslägets HUD öppnar samma läsverktyg som den vanliga verktygsraden. Panelen
ligger direkt under body, med fokuscykel och Escape till föregående knapp.
Läsprogressen har tre diskreta bredder (104/164/232 px), tre tjocklekar
(3/5/7 px), sex placeringar och ett av/på-val. Färg följer artikelns accent.
Inställningarna sparas lokalt. Progress mäter aktuell position i lästexten;
det är inte bevis på förståelse eller att varje stycke har lästs. Källförteckning,
navigering och kommentarer räknas inte in i den musikaliska analysen.

Läsmusiken förbereds vid sidöppning men kräver ett uttryckligt startklick.
Den är en separat komposition inspirerad av VävR Hard Fork reborn Fable 5.1.1:
återkommande motiv, gemensam harmonik, svarande stämmor och begränsade resurser.
Bas/puls, mjuka plock, flöjtklang, klockklang och en trestämmig klangbotten delar
samma tonskala. Ingen VävR-motor eller ljudbibliotek laddas.

`reader-focus-media.mjs` följer läspositionen. `reader-score-analysis.mjs` gör
lokal analys och `reader-music-plan.mjs` skapar en liten notplan som
`reader-soundscape.mjs` spelar. Dessa är delar av samma gemensamma läslager.

Analysen är en regelbaserad musikalisk tolkning med svensk/engelsk ordlista,
meningsbunden negation, några vanliga böjningsformer och kontext från dokument,
avsnitt, rubrik och närliggande text. Negation dämpar en signal utan att vända
sorg till glädje. Korta h1–h6-rubriker, tabellrader, listintroduktioner och citat
får egna läsankare. Tabelltext räknas en gång. Grannblandning beräknas från
oförändrade profiler inom samma avsnitt. Ordträffarnas stödstyrka är inte en
sannolikhet för textens känsla: svag signal får färga klangen utan starka
förändringar av tonkön. Ironi, andra språk och fackuttryck kan fortfarande
tolkas fel. Ingen text skickas till en tjänst och ingen råtext sparas i analysen.
Max 1 600 block/avsnitt, 600 000 tecken totalt och 16 000 tecken per block
analyseras; trunkering ger en synlig begränsningsnotis.

Läspositionen tas vid 38 procent av skärmhöjden. Tomrum hör till föregående
textregion, och grannblandning passerar inte avsnittsgränser. Snabb scrollning
samlar mål tills positionen varit stilla i 220 ms. Efter åtta sekunders läsvila
kan nästa fras få lite mer andrum; det är ingen mätning av faktisk läshastighet.
Ett nytt kandidattonkön ska vara stabilt minst 1,5 sekunder och införs vid nästa
tvåtaktsgräns. Styckes-ID återställer inte denna väntan. Små tröskelpendlingar
har en marginal. Grundtonen och dokumentmotivet är stabila oavsett startposition.

### Melodisk form (VEP-förbättring 2026-09-22)

En åttataktsbåge ger presentation, svar, varsam variation och hemkomst eller
öppet avslut. Den bygger på ett dokumentmotiv. Textens menings-/styckelängd,
avsnittsprofil, citat/slut och läsvila påverkar luft, artikulation och avslut.
Plocket lämnar avsiktliga luckor åt två korta flöjtsvar i varannan takt.
En lågmäld klockaccent kan komma i slutet av hela bågen. Genomgångstoner är
tillåtna, men viktiga ankomster relateras till ackordet.

Alla tre ackordtoner härleds ur vald skala. Gemensamma padtoner hålls kvar,
och övriga får närliggande ackordläge. Frekvensbyte sker i en verklig nollplatå.
En takts gemensam tonika/kvint med fördröjd bas knyter ihop tonkönsbyten.
Basen följer samma harmoniska plan. Två konkreta takter planeras åt gången;
rytm och tempo låses inom paret så att senare mål inte flyttar reserverade
anslag tidigare. Kortare notlängder och uttryckliga pauser håller alla planerade
anslag inom de befintliga rösterna, även över tempogränser. De långa bågarna
låser alltså inte textresponsen i åtta takter. Energi och klang glider under
pågående fras med tidsbaserad utjämning. Befintlig uppläsning dämpar musikvolymen.

### Resurskontrakt

- Ingen AudioContext före användarstart. Högst en aktiv eller stängande context.
- Exakt 11 återanvända oscillatorer och 40 ljudnoder; inga nya noder per ton.
- En scheduler på 40 ms, 120 ms ljudframförhållning, högst fyra steg per körning.
  Försenade steg hoppas över; ingen upphämtningskö byggs efter throttling.
- Högst två planerade takter och 64 nothändelser. Planer ersätts och släpps;
  ingen växande not-/scrollhistorik. Dessa JavaScript-objekt har ingen påstådd
  exakt heapstorlek. Media har högst en timer för scrollstabilisering/läsvila.
- Filtermål uppdateras högst en gång per slag och bara vid relevant skillnad;
  framtida automation ersätts med kontinuitetsbevarande omplanering där API finns.
- Kort fördröjning med begränsad återkoppling; inga samplings-/reverbbuffertar.
- Vanligt stopp tonar ut på 350 ms. Både motor och UI kontrollerar ägarskap för
  asynkrona svar; en gammal start som lyckas eller misslyckas påverkar inte en ny.
- Stopp, nollvolym, fokusavslut, dold flik och pagehide stoppar oscillatorer,
  kopplar loss noder, tömmer planer/timers och stänger AudioContext.
  Ny start tillåts först efter avslutad stängning. Vid misslyckad close behålls
  den tysta contextens ägarskap, ny start spärras och UI ber om omladdning.
- Vid pagehide avbryts analys, geometri/referenser töms och ResizeObserver
  kopplas loss. BFCache-återkomst analyserar om och väntar på nytt startklick.

### Kontroller och deras räckvidd

Node-tester täcker textstruktur/negation/budget, musikaliska planer och verkliga
scheduler/notmetoder med kontrollerade ljudparametrar, alla tolv riktade
modebyten vid fyra ackordpositioner, padkontinuitet, temporeservationer och
asynkrona motor-/UI-race. De portabla testerna kräver inga extra paket.

Chrome-prov omfattar alla 32 essäer, 390/768/1024/1440 px, 18 val av
progressstorlek/placering, touch, mörkt tema, reducerad rörelse, Escape och
sparade inställningar. 25 start/stopp-cykler och 60 scrollhändelser kontrollerar
resursantal och städning; visibility/pagehide/pageshow provas med simulerade
livscykelhändelser. En 45 s OfflineAudioContext-rendering i 48 kHz kontrollerar
ändliga värden och nivåer. Ett separat längre Chrome-prov mäter post-GC-JS-heap,
planstorlek och verkliga skapade/stängda contexts. Varaktighet och mätvärden
redovisas i releasekvittot; dessa är inte bevis för frånvaro av alla native-,
drivrutins- eller långtidsläckor. Fysisk Safari/iPad och mänsklig jämförande
lyssningsacceptans återstår och är inte påstådda PASS.

Web Audio-livscykel: https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/close

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

`reader-focus-media.mjs` analyserar dokumentet genom `reader-soundscape.mjs`.
Detta är en lokal, regelbaserad musikalisk tolkning med svensk/engelsk ordlista,
enkel negationshantering, dokument/rubrik/närliggande styckeskontext och
styckelängder. Det är inte en språkmodell eller en tillförlitlig klassificering
av känslor; ironi, andra språk och fackuttryck kan tolkas fel. Grundkaraktären
kan vara dur, moll, dorisk eller lydisk. Ingen text skickas till en tjänst.
Max 1 600 block, 600 000 tecken totalt, 16 000 tecken per block analyseras;
mycket långa dokument får en synlig begränsningsnotis. Råtext behålls inte.

Läspositionen tas vid 38 procent av skärmhöjden och blandas med nästa stycke.
Ny karaktär får landa minst 1,5 sekunder innan tonkön kan ändras vid taktgräns;
minst två takter mellan byten. En takt med grundton/kvint ger en mjuk övergång.
Energi och klang ändras gradvis. Långa stycken får glesare, längre fraser.
Befintlig uppläsning dämpar musikvolymen.

### Resurskontrakt

- Ingen AudioContext före användarstart, högst en per musiksession.
- Exakt 11 återanvända oscillatorer, 40 ljudnoder totalt; inga nya noder per ton.
- En scheduler på 40 ms, 120 ms framförhållning, högst fyra steg per körning.
  Försenade steg hoppas över; ingen upphämtningskö byggs efter throttling.
- Kort fördröjning med begränsad återkoppling; inga samplings-/reverbbuffertar.
- Vanligt stopp tonar ut på 350 ms. Stopp under start kan inte återstarta motorn.
- Stopp, nollvolym, fokusavslut, dold flik och pagehide tömmer ljudgrafen,
  stoppar oscillatorerna, kopplar loss noder, släpper referenser och stänger
  AudioContext. Ny start tillåts först när stängningen är klar.
- Vid pagehide avbryts analysen, geometri/referenser töms och ResizeObserver
  kopplas loss. BFCache-återkomst analyserar om och väntar på nytt startklick.

Kontroller: ordinarie Node-testsvit samt beteendetester för analys, läsprogress,
fördröjd ljudstart och överlappande stopp. Chrome UI-/Web Audio-prov omfattar
390/768/1024/1440 px, 18 storlek/placeringskombinationer, pekskärm, mörkt tema,
reducerad rörelse, Escape och sparade inställningar; 25 start/stopp-cykler,
60 snabba scrollningar och simulerade visibility/pagehide/pageshow-händelser.
45 s riktig OfflineAudioContext-rendering i 48 kHz kontrollerar ändliga värden,
ljudnivåer och tonartsövergång. Resursräkning är inte en långtidsmätning av
webbläsarens totala heap. Fysisk iPad/Safari och mänsklig lyssningsacceptans
återstår och är inte påstådda PASS.

Web Audio-livscykel: https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/close

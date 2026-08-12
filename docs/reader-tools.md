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

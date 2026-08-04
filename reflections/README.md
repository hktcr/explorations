# Reflektionsspår för Explorations

Detta lager gör det möjligt att markera artikeltext, skriva många privata kommentarer, exportera ett valfritt urval till ChatGPT och läsa tillbaka bearbetade reflektioner med kopplingen till originalkommentarerna bevarad.

## Separat från VävR

Reflektionsspåret tillhör endast Explorations. Det delar inte databas, lagring, synkning, kodkörning eller dokumentmodell med VävR. Likheter i arbetssätt är medvetna, men systemen ska kunna utvecklas och fungera oberoende av varandra.

## Filer

- `article-registry.json` beskriver de stabila EXP-id:n, artikelsökvägarna och den textrot som får kommenteras.
- `reflections-core.mjs` innehåller format, ankare, revisioner, export och validering.
- `reflections-store.mjs` ansvarar för privat lokal lagring i IndexedDB.
- `reflections.css` innehåller det namespacade gränssnittet för desktop, iPad och mobil.
- Ett separat runtime kopplar markering, panel, export och import till artikelsidorna.

Alla gränssnittsklasser använder prefixet `xr-`. Id:n ska också använda `xr-` eller det längre prefixet `explorations-reflections-`. Detta minskar risken för konflikter med de många befintliga artikelmallarna.

## Lokal lagring och antal kommentarer

Privata kommentarer, ankare, kommentarrevisioner och exporthistorik lagras i IndexedDB i den aktuella webbläsaren. Råkommentarer får aldrig skrivas till `engagement.public.json`.

Det finns ingen appbyggd gräns för antalet kommentarer. Användaren ska kunna fortsätta skriva kommentarer utan att exportera mellan varje anteckning. Den verkliga yttergränsen bestäms ändå av webbläsarens lagringskvot, enhetens lediga utrymme och webbläsarens regler för rensning av webbplatsdata.

Lokal lagring är inte samma sak som synkning. Kommentarer på en iPad visas inte automatiskt på en mobil eller dator. Privat läge, rensad webbplatsdata eller lagringsrensning i Safari kan ta bort lokala data. Gränssnittet ska därför visa att materialet sparas på den här enheten och erbjuda regelbunden backup. Om webbläsaren stöder beständig lagring kan runtime begära den, men en sådan begäran ersätter inte backup.

## Ankare och flera kommentarer

Ett textankare är en egen post. Det innehåller artikelns EXP-id, textposition, exakt citat, omgivande text, närmaste avsnitt och dokumentfingeravtryck. Flera kommentarer kan peka på samma ankare. Varje kommentar har ändå eget id och egen revisionshistorik.

Ankaret ska i första hand återfästas med position när artikelrevisionen stämmer. Därefter används ett unikt citat med prefix och suffix. En tvetydig träff får statusen `Behöver kopplas`. Systemet får inte tyst välja ett ungefärligt stycke.

## Export

Export är en ögonblicksbild. Den tar inte bort, låser eller döljer kommentarer.

Användaren kan exportera:

- nya och ändrade kommentarer
- alla kommentarer
- ett eget urval

Den primära vägen på iPad är kopierad Markdown för ChatGPT. Ett maskinläsbart JSON-paket används som backup och som stabil källa för id:n, revisioner och ankare. En kommentar får ingå i flera exportbatchar. Statusen beräknas mot den aktuella revisionen och ska därför kunna vara ny, ändrad efter export, exporterad eller bearbetad.

## Import av returpaket

Ett returpaket har formatet `explorations-reflections`, pakettypen `reflection-return` och en koppling till ursprungligt export-id. Varje bearbetad reflektion pekar tillbaka på en eller flera exakta kommentarrevisioner.

Importen ska alltid valideras och förhandsvisas innan något skrivs. Förhandsvisningen skiljer mellan matchade poster, poster som behöver kopplas, okända poster, redan importerade poster och konflikter. Återimport av samma paket ska vara idempotent.

En importerad reflektion är en lokal bearbetad draft. Import innebär inte automatisk publicering och uppdaterar inte GitHub. Publicering till det befintliga publika engagemangslagret är ett separat, uttryckligt steg.

## Tre separata publika spår

De publika signalerna får inte blandas:

- Läst kräver uttrycklig bekräftelse och får inte härledas från scrollning.
- Reflekterad avser en bearbetad eller publicerad reflektion, inte en rå privat kommentar.
- Readwise avser metadata om tidigare läsning och innebär inte automatiskt att en källa är färdigläst, verifierad eller instämd i.

Symbolerna är monokroma och har olika form. Betydelsen ska dessutom finnas i synlig legend och tillgänglig text.

## Responsivitet och tillgänglighet

Från 1180 CSS-pixlar används en dockad sidopanel som lämnar artikeltexten synlig. Under 1180 pixlar används ett bottenblad. CSS kan läsa variablerna `--xr-visual-viewport-height` och `--xr-visual-viewport-offset-top`, som runtime uppdaterar från `window.visualViewport` när ett virtuellt tangentbord öppnas.

Kontroller har minst 44 gånger 44 CSS-pixlars träffyta på touch. Fokus, status och val uttrycks inte enbart med färg. Stilar finns för `forced-colors`, reducerad rörelse, safe area och utskrift. Svenskt gränssnitt ska märkas med `lang="sv"` även när artikeltexten är engelsk.

## Viktig varning om källsynkning

`/workspace/explorations` är enligt repots egen instruktion en publiceringskopia som synkas från `../Utforskningar/` via `deploy.sh`. Ändringar som endast görs i publiceringskopian kan skrivas över vid nästa synkning.

Alla bestående ändringar i detta reflektionslager måste därför också föras in i den verkliga källan innan nästa deploy. Kontrollera alltid både källan och publiceringskopian före push. Synkningssteget får inte råka föra privata IndexedDB-data, råkommentarer eller råa Readwise-highlights till det publika repot.

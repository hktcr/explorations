# Det granskade essänätverket

Nätverket publicerar kunskapsrelationer, inte automatisk ordlikhet. En publik kant måste finnas i `relations-curated.json`, ha status `reviewed`, en tillåten relationstyp, en konkret motivering och specifika gemensamma begrepp.

`scripts/build_search_index.py` läser bibliotekskorten, essäerna och den granskade relationsfilen. Den skapar deterministiskt `sok-index.json` och `natverk-index.json`. Kör därefter `node scripts/validate-network.cjs` och `node --test`.

Gränssnittet är byggt med progressiv förbättring. Kortvyn och en enklare kortsökning fungerar även om ett index inte kan laddas. Nätverket kräver aldrig hovring. Noder har minst 44 pixlars tryckyta, tangentbordsstöd, reducerad rörelse och ett listbaserat relationsalternativ.

Responsivitetskontraktet omfattar moderna Chrome, Edge, Firefox och Safari på aktuella versioner av Windows, macOS, Linux, ChromeOS, Android, iOS och iPadOS. Layouten har särskilda lägen för högst 390 pixlar, högst 700 pixlar och minst 900 pixlar. Äldre eller ovanliga webbläsare ska fortfarande behålla den grundläggande kortvyn.

Publicering följer den gemensamma rutinen i `hktcr/gaia-tools/PUBLICERINGSRUTIN.md`. Detta repo är den kanoniska Pages-källan. En saknad lokal GitHub CLI är inte ett publiceringshinder när den anslutna GitHub-appen har skrivrätt.

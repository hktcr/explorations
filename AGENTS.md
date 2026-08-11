# Instruktioner för publicering

Detta repo är den kanoniska källan för `https://hktcr.github.io/explorations/`.

Före publicering ska den gemensamma rutinen i `hktcr/gaia-tools/PUBLICERINGSRUTIN.md` läsas och följas. Den anslutna GitHub-appen är primär skrivväg när den har skrivrätt. Saknad `gh` är inte ett hinder i det läget.

Kör alltid följande före publicering:

```sh
python3 scripts/build_search_index.py
node scripts/validate-network.cjs
node --test
```

Publicera hela releasen som en enda atomisk commit mot en verifierat oförändrad `main`. Använd aldrig `force`. Kontrollera därefter den verkliga Pages-adressen. En lokal commit eller en uppdaterad `main` får inte kallas verifierad publicering innan den publika sidan har lästs tillbaka och kärnfunktionerna har provats.

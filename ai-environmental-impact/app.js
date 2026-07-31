
    document.addEventListener("DOMContentLoaded", () => {
      const content = document.querySelector(".content");
      const defaultSize = 18;
      let currentSize = Number(localStorage.getItem("explorationsFontSize") || defaultSize);
      const setFontSize = size => {
        currentSize = size;
        content.style.fontSize = size + "px";
        localStorage.setItem("explorationsFontSize", size);
      };
      setFontSize(currentSize);

      const toggle = document.getElementById("fontToggle");
      if (localStorage.getItem("explorationsFontFamily") === "sans") {
        document.body.classList.add("sans-serif-mode");
        toggle.textContent = "Serif";
      }
      toggle.addEventListener("click", () => {
        document.body.classList.toggle("sans-serif-mode");
        const sans = document.body.classList.contains("sans-serif-mode");
        localStorage.setItem("explorationsFontFamily", sans ? "sans" : "serif");
        toggle.textContent = sans ? "Serif" : "Sans";
      });
      document.getElementById("fontDecrease").addEventListener("click", () => setFontSize(Math.max(12, currentSize - 1)));
      document.getElementById("fontIncrease").addEventListener("click", () => setFontSize(Math.min(32, currentSize + 1)));
      document.getElementById("fontReset").addEventListener("click", () => setFontSize(defaultSize));
      document.getElementById("printArticle").addEventListener("click", () => window.print());

      const headings = document.querySelectorAll(".content h2[id], .content h3[id]");
      const observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          document.querySelectorAll(".toc a").forEach(a => a.classList.remove("active"));
          document.querySelector(`.toc a[href="#${entry.target.id}"]`)?.classList.add("active");
        });
      }, { rootMargin: "0px 0px -78% 0px" });
      headings.forEach(h => observer.observe(h));

      const search = document.getElementById("articleSearch");
      document.body.insertAdjacentHTML("beforeend", '<div id="searchPopup" class="search-popup"><div class="search-popup-header"><span id="searchCount">0 results</span><button id="closeSearch" type="button" aria-label="Close search">×</button></div><ul id="searchResults" class="search-popup-results"></ul></div>');
      const popup = document.getElementById("searchPopup");
      const results = document.getElementById("searchResults");
      const count = document.getElementById("searchCount");

      const clearHighlights = () => {
        document.querySelectorAll("mark.search-highlight").forEach(mark => {
          mark.replaceWith(document.createTextNode(mark.textContent));
        });
        content.normalize();
      };

      document.getElementById("closeSearch").addEventListener("click", () => {
        popup.classList.remove("visible");
        clearHighlights();
        search.value = "";
      });

      search.addEventListener("input", () => {
        clearHighlights();
        results.innerHTML = "";
        const query = search.value.trim();
        if (query.length < 3) {
          popup.classList.remove("visible");
          return;
        }
        const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const regex = new RegExp(escaped, "gi");
        const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
        const nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);
        let matches = 0;

        nodes.forEach(node => {
          if (!regex.test(node.nodeValue)) return;
          regex.lastIndex = 0;
          const fragment = document.createDocumentFragment();
          let last = 0;
          for (const match of node.nodeValue.matchAll(regex)) {
            fragment.append(node.nodeValue.slice(last, match.index));
            const mark = document.createElement("mark");
            mark.className = "search-highlight";
            mark.textContent = match[0];
            fragment.append(mark);

            const item = document.createElement("li");
            item.className = "search-popup-result-item";
            const start = Math.max(0, match.index - 45);
            item.textContent = "…" + node.nodeValue.slice(start, match.index + match[0].length + 55) + "…";
            item.addEventListener("click", () => {
              document.querySelectorAll("mark.active-highlight").forEach(m => m.classList.remove("active-highlight"));
              mark.classList.add("active-highlight");
              mark.scrollIntoView({ behavior: "smooth", block: "center" });
            });
            results.append(item);
            matches += 1;
            last = match.index + match[0].length;
          }
          fragment.append(node.nodeValue.slice(last));
          node.replaceWith(fragment);
        });

        count.textContent = matches + (matches === 1 ? " result" : " results");
        popup.classList.toggle("visible", matches > 0);
      });
    });
  
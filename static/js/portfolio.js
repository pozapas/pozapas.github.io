(() => {
  const menuButton = document.querySelector(".menu-toggle");
  const navigation = document.querySelector(".main-navigation");

  const closeMenu = () => {
    if (!menuButton || !navigation) return;
    navigation.classList.remove("is-open");
    menuButton.setAttribute("aria-expanded", "false");
    document.body.classList.remove("menu-open");
  };

  if (menuButton && navigation) {
    menuButton.addEventListener("click", () => {
      const isOpen = navigation.classList.toggle("is-open");
      menuButton.setAttribute("aria-expanded", String(isOpen));
      document.body.classList.toggle("menu-open", isOpen);
    });

    navigation.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", closeMenu);
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeMenu();
    });
  }

  const setupArtifactLoader = ({
    itemSelector,
    controlsSelector,
    moreSelector,
    allSelector,
    countSelector,
    batchSize,
    noun,
    afterReveal,
  }) => {
    const items = Array.from(document.querySelectorAll(itemSelector));
    const controls = document.querySelector(controlsSelector);
    const moreButton = document.querySelector(moreSelector);
    const allButton = document.querySelector(allSelector);
    const countLabels = document.querySelectorAll(countSelector);

    if (!items.length || !controls || !moreButton || !allButton) return;

    const visibleCount = () => items.filter((item) => !item.hidden).length;

    const refresh = () => {
      const visible = visibleCount();
      const remaining = items.length - visible;
      countLabels.forEach((label) => {
        label.textContent = `(${visible}/${items.length})`;
      });

      if (remaining === 0) {
        controls.hidden = true;
        return;
      }

      controls.hidden = false;
      moreButton.textContent = `Load ${Math.min(batchSize, remaining)} more ${noun}`;
      allButton.textContent = `Load all ${items.length} ${noun}`;
      afterReveal?.();
    };

    moreButton.addEventListener("click", () => {
      items.filter((item) => item.hidden).slice(0, batchSize).forEach((item) => {
        item.hidden = false;
      });
      afterReveal?.();
      refresh();
    });

    allButton.addEventListener("click", () => {
      items.forEach((item) => {
        item.hidden = false;
      });
      afterReveal?.();
      refresh();
    });

    refresh();
  };

  const softwareSection = document.querySelector("[data-software-section]");
  const updateSoftwareSection = () => {
    if (!softwareSection) return;
    const visibleSoftware = Array.from(softwareSection.querySelectorAll("[data-tool]")).some(
      (item) => !item.hidden
    );
    softwareSection.hidden = !visibleSoftware;
  };

  setupArtifactLoader({
    itemSelector: "[data-tool]",
    controlsSelector: "[data-tool-controls]",
    moreSelector: "[data-load-more-tools]",
    allSelector: "[data-load-all-tools]",
    countSelector: "[data-tool-nav-count], [data-tool-heading-count]",
    batchSize: 8,
    noun: "tools",
    afterReveal: updateSoftwareSection,
  });

  setupArtifactLoader({
    itemSelector: "[data-publication]",
    controlsSelector: "[data-paper-controls]",
    moreSelector: "[data-load-more-papers]",
    allSelector: "[data-load-all-papers]",
    countSelector: "[data-paper-nav-count], [data-paper-heading-count]",
    batchSize: 6,
    noun: "papers",
  });

  const copyText = async (text) => {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const input = document.createElement("textarea");
    input.value = text;
    input.setAttribute("readonly", "");
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.appendChild(input);
    input.select();
    document.execCommand("copy");
    input.remove();
  };

  document.querySelectorAll("[data-citation]").forEach((button) => {
    button.addEventListener("click", async () => {
      const label = button.querySelector("span");
      if (!label) return;
      const oldLabel = label.textContent;

      try {
        await copyText(button.dataset.citation || "");
        label.textContent = "Copied";
      } catch {
        label.textContent = "Copy failed";
      }

      window.setTimeout(() => {
        label.textContent = oldLabel;
      }, 1600);
    });
  });

  const sectionLinks = Array.from(document.querySelectorAll(".section-navigation a[href^='#']"));
  if ("IntersectionObserver" in window && sectionLinks.length) {
    const sections = sectionLinks
      .map((link) => document.querySelector(link.getAttribute("href")))
      .filter(Boolean);

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!visible) return;

        sectionLinks.forEach((link) => {
          const active = link.getAttribute("href") === `#${visible.target.id}`;
          if (active) link.setAttribute("aria-current", "true");
          else link.removeAttribute("aria-current");
        });
      },
      { rootMargin: "-125px 0px -65% 0px", threshold: [0, 0.1, 0.4] }
    );

    sections.forEach((section) => observer.observe(section));
  }
})();

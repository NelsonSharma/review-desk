(() => {
  try {
    const value = localStorage.getItem("literature-desk-theme");
    if (["lavender", "paper", "midnight", "forest"].includes(value)) document.documentElement.dataset.theme = value;
  } catch { /* The stylesheet supplies the default theme. */ }
})();

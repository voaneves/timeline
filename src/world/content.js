// The world reads the semantic DOM (single source of truth): eras, entries, projects.
export function readContent() {
  const eras = [...document.querySelectorAll(".era")].map((el) => ({
    n: Number(el.dataset.era),
    name: el.dataset.eraName,
    years: el.querySelector(".era-years").textContent.trim(),
    entries: [...el.querySelectorAll('article[data-kind="entry"]')].map((a) => ({
      id: a.id,
      era: Number(el.dataset.era),
      title: a.querySelector("h4").textContent.trim(),
      label: a.querySelector("time").textContent.trim(),
      year: a.querySelector("time").getAttribute("datetime").slice(0, 4),
    })),
  }));
  const projects = [...document.querySelectorAll('article[data-kind="project"]')].map((a) => ({
    id: a.id,
    title: a.querySelector("h3").textContent.trim(),
  }));
  return { eras, projects };
}

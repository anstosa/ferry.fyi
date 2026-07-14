export const removeSeedSeoTags = (root: ParentNode = document): void => {
  root.querySelectorAll("[data-seo-seed]").forEach((element) => {
    element.remove();
  });
};

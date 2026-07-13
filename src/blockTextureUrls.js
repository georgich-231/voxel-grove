const BLOCK_TEXTURE_MODULES = import.meta.glob("./assets/blocks/*.png", {
  eager: true,
  import: "default",
  query: "?url",
});

export const BLOCK_TEXTURE_URL_BY_FILE = new Map(
  Object.entries(BLOCK_TEXTURE_MODULES).map(([path, url]) => [path.split(/[\\/]/).pop(), url]),
);

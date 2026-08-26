// hide capacitor's synthetic then method from promise resolution
export const createNonThenableCapacitorPlugin = <Plugin extends object>(
  plugin: Plugin
): Plugin =>
  new Proxy(plugin, {
    // preserve native methods behind one promise-safe boundary
    get(target, property, receiver) {
      // prevent promise assimilation from invoking a native then method
      if (property === "then") {
        return undefined;
      }
      return Reflect.get(target, property, receiver);
    },
  });

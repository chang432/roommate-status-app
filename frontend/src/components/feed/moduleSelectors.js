export function getModuleCounts(modules, allTypes) {
  const counts = modules.reduce((result, module) => {
    if (!module.isArchived) {
      result[module.type] = (result[module.type] ?? 0) + 1;
    }
    return result;
  }, {});
  counts.all = modules.filter(
    (module) => !module.isArchived && allTypes.includes(module.type),
  ).length;
  return counts;
}

export function modulesForCategory(modules, allTypes, type) {
  return type === "all"
    ? modules.filter((module) => allTypes.includes(module.type))
    : modules.filter((module) => module.type === type);
}

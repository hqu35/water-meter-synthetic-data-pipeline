// Recursively walks a plain-data object/array and collects paths where a
// number is NaN/Infinity, or a value the caller considers "required" is
// undefined. Used to sanity-check generated meter configs and metadata.

export function scanForNonFinite(value, path = "$") {
  const problems = [];
  if (typeof value === "number") {
    if (!Number.isFinite(value)) problems.push(`${path} = ${value}`);
    return problems;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => problems.push(...scanForNonFinite(item, `${path}[${i}]`)));
    return problems;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      problems.push(...scanForNonFinite(item, `${path}.${key}`));
    }
    return problems;
  }
  return problems;
}

export function scanForUndefined(value, path = "$") {
  const problems = [];
  if (value === undefined) {
    problems.push(path);
    return problems;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => problems.push(...scanForUndefined(item, `${path}[${i}]`)));
    return problems;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      problems.push(...scanForUndefined(item, `${path}.${key}`));
    }
    return problems;
  }
  return problems;
}

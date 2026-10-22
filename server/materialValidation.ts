export function duplicateMaterialIds(materials: ReadonlyArray<{ itemId: string }>): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const material of materials) {
    if (seen.has(material.itemId)) duplicates.add(material.itemId);
    else seen.add(material.itemId);
  }
  return [...duplicates];
}

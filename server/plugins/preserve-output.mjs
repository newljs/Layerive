// Plugins choose the region policy; the host owns the actual image processing.
export async function preserveOutput(host, prepared, output) {
  if (!prepared.source) return output;
  host.updateTask({ stage: 'preserving' });
  return prepared.regions
    ? host.preserveOutsideRegions(prepared.source, output, prepared.regions, prepared.protectedRegions || [])
    : host.preserveOutsideRegion(prepared.source, output, prepared.rect);
}

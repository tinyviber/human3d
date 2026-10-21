/** Merge a selected-player measurement into a previously complete study. */
export function mergeSelectedProfiles(previous, update, selectedIds) {
  const profiles = {...previous.profiles};
  for (const id of selectedIds) {
    if (update.profiles[id]) profiles[id] = update.profiles[id];
  }
  return {...previous, ...update, profiles};
}

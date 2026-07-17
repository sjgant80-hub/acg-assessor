// A tiny inventory library. Pure functions over an array of { name, quantity, addedAt }.

export function addItem(list, item) {
  if (!item || !item.name) throw new Error('item needs a name');
  return [...list, { ...item, addedAt: list.length }];
}

export function removeItem(list, name) {
  return list.filter(entry => entry.name !== name);
}

export function totalQuantity(list) {
  return list.reduce((sum, entry) => sum + (entry.quantity || 0), 0);
}

export function findItem(list, name) {
  return list.find(entry => entry.name === name) || null;
}

export function itemNames(list) {
  return list.map(entry => entry.name).sort();
}

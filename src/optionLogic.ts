import type { Locale, MenuItem, ProductOptionGroup, ProductSelection } from './types';

export function activeOptionGroups(item: MenuItem) {
  return item.optionGroups || [];
}

export function normalizeSelections(groups: ProductOptionGroup[], selections: ProductSelection[]) {
  return groups.flatMap(group => {
    const allowed = new Set(group.options.filter(option => option.available).map(option => option.id));
    const optionIds = [...new Set(selections.find(value => value.groupId === group.id)?.optionIds || [])]
      .filter(id => allowed.has(id))
      .slice(0, group.mode === 'single' ? 1 : group.max);
    return optionIds.length ? [{ groupId: group.id, optionIds }] : [];
  });
}

export function validateSelections(item: MenuItem, selections: ProductSelection[]) {
  const groups = activeOptionGroups(item);
  const normalized = normalizeSelections(groups, selections);
  const valid = groups.every(group => {
    const count = normalized.find(value => value.groupId === group.id)?.optionIds.length || 0;
    const minimum = group.required ? Math.max(1, group.min) : group.min;
    return count >= minimum && count <= group.max;
  });
  return { valid, selections: normalized };
}

export function configuredPrice(item: MenuItem, selections: ProductSelection[]) {
  const groups = activeOptionGroups(item);
  const normalized = normalizeSelections(groups, selections);
  const extras = normalized.reduce((sum, selection) => {
    const group = groups.find(value => value.id === selection.groupId);
    return sum + selection.optionIds.reduce((groupSum, id) => groupSum + (group?.options.find(option => option.id === id)?.priceDelta || 0), 0);
  }, 0);
  return Math.round((item.price + extras) * 100) / 100;
}

export function selectionLabels(item: MenuItem, selections: ProductSelection[], locale: Locale) {
  return normalizeSelections(activeOptionGroups(item), selections).flatMap(selection => {
    const group = item.optionGroups?.find(value => value.id === selection.groupId);
    return selection.optionIds.map(id => group?.options.find(option => option.id === id)?.name[locale]).filter(Boolean) as string[];
  });
}

export function cartLineKey(itemId: string, selections: ProductSelection[] = []) {
  const signature = selections
    .map(selection => `${selection.groupId}:${[...selection.optionIds].sort().join(',')}`)
    .sort()
    .join('|');
  return `${itemId}::${signature}`;
}

export function configuredCartItem(item: MenuItem, selections: ProductSelection[]) {
  return { ...item, price: configuredPrice(item, selections) };
}

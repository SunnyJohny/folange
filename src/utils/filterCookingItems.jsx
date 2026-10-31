export function filterCookingItems(cookingitems, searchQuery) {
  if (!searchQuery) return cookingitems;
  return cookingitems.filter((item) =>
    item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    item.description.toLowerCase().includes(searchQuery.toLowerCase())
  );
}
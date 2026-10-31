
 // src/config/folangePaths.js

export const FOLANGE_STORE_ID = "folange";

export const FOLANGE_ROOT_PATH = Object.freeze([
  "folange",
  "main",
]);

export const FOLANGE_MEDIA_ROOT = "folange/cookingitems";

export const FOLANGE_SHIPMENT_EVENT = "folange-shipment-sync";

export const FOLANGE_BROWSER_KEYS = Object.freeze({
  cart: "folange_cart",
  wishlist: "folange_local_wishlist_ids",
  visitor: "folange_visitor_id",
  productsCache: "folange_cookingitems_cache",
  productsCacheTime: "folange_cookingitems_cache_time",
});

const validateSegment = (value, label) => {
  if (
    typeof value !== "string" ||
    !value ||
    value.trim() !== value ||
    value.includes("/")
  ) {
    throw new Error(`Invalid FOLANGE ${label}.`);
  }

  return value;
};

export const folangeCollectionPath = (name) => [
  ...FOLANGE_ROOT_PATH,
  validateSegment(name, "collection name"),
];

export const folangeDocumentPath = (name, id) => [
  ...folangeCollectionPath(name),
  validateSegment(id, "document ID"),
];

// Products are stored in folange/main/cookingitems.
export const folangeProductPath = (id) =>
  folangeDocumentPath("cookingitems", id);

// User profiles are stored in folange/main/users.
export const folangeUserPath = (uid) =>
  folangeDocumentPath("users", uid);

// Orders belong to their respective users.
export const folangeUserOrdersPath = (uid) => [
  ...folangeUserPath(uid),
  "orders",
];

export const folangeUserOrderPath = (uid, orderId) => [
  ...folangeUserOrdersPath(uid),
  validateSegment(orderId, "order ID"),
];

// Accept only folange/main/users/{uid}/orders/{orderId}.
export const isFolangeOrderPath = (path) => {
  if (typeof path !== "string") {
    return false;
  }

  const parts = path.split("/");

  return (
    parts.length === 6 &&
    parts.every((part) => part && part.trim() === part) &&
    parts[0] === FOLANGE_STORE_ID &&
    parts[1] === "main" &&
    parts[2] === "users" &&
    parts[4] === "orders"
  );
};

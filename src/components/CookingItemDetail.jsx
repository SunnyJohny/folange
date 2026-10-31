import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase";
import { toast } from "react-toastify";
import { useMyContext } from "../Context/MyContext";

export default function CookingItemDetail() {
  const { itemId } = useParams();
  const navigate = useNavigate();

  const { addToCart, capitalizeWords } = useMyContext();

  const [item, setItem] = useState(null);
  const [loadingItemId, setLoadingItemId] = useState(null);

  // 🔹 Fetch item from Firestore
  useEffect(() => {
    const fetchItem = async () => {
      try {
        const docRef = doc(db, "cookingitems", itemId);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          setItem({ id: docSnap.id, ...docSnap.data() });
        } else {
          toast.error("Item not found");
          navigate("/");
        }
      } catch (err) {
        console.error("Error fetching item:", err);
        toast.error("Failed to load item details");
      }
    };
    fetchItem();
  }, [itemId, navigate]);

  // ✅ Same addToCart logic as in CookingItems
  const handleAddToCart = async (item) => {
    setLoadingItemId(item.id);
    try {
      await new Promise((res) => setTimeout(res, 600));
      addToCart(item, item.priceDiscounted);
      toast.success(`${item.name} added to cart!`);
    } finally {
      setLoadingItemId(null);
    }
  };

  if (!item)
    return (
      <div className="flex justify-center items-center h-screen text-gray-500">
        Loading item details...
      </div>
    );

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
      onClick={(e) => e.target === e.currentTarget && navigate("/")}
    >
      <div className="bg-white p-6 rounded-lg max-w-lg w-full relative shadow-xl">
        {/* Close Button */}
        <button
          onClick={() => navigate("/")}
          className="absolute top-2 right-2 text-gray-500 hover:text-gray-700"
        >
          ✕
        </button>

        {/* Name */}
        <h2 className="text-2xl font-bold mb-2 text-center">
          {capitalizeWords(item.name)}
        </h2>

        {/* Image */}
        <img
          src={item.image || "/placeholder.jpg"}
          alt={item.name}
          className="w-full h-64 object-cover rounded mb-4"
        />

        {/* Description */}
        <p className="mb-2">{item.description}</p>
        {item.size && (
          <p className="mb-1 text-sm text-gray-600">Size: {item.size}</p>
        )}
        {item.color && (
          <p className="mb-1 text-sm text-gray-600">Color: {item.color}</p>
        )}
        {item.category && (
          <p className="mb-2 text-sm italic text-gray-600">
            Category: {item.category}
          </p>
        )}

        {/* Status */}
        <p className="mb-2 text-sm font-semibold">
          Status:{" "}
          <span
            className={`px-2 py-1 text-xs rounded text-white ${
              item.status === "Available" ? "bg-green-600" : "bg-yellow-600"
            }`}
          >
            {item.status || "Unavailable"}
          </span>
        </p>

        <p className="mt-2 text-sm text-gray-600">
          {item.status === "Available"
            ? "✅ This item is in stock and ready for delivery."
            : "🕒 This item will be available soon."}
        </p>

        {/* Prices */}
        {item.priceOriginal && (
          <p className="mb-2 text-gray-400 line-through">
            Original: ₦{item.priceOriginal.toLocaleString()}
          </p>
        )}
        {item.priceDiscounted && (
          <p className="font-semibold text-red-600 text-lg mb-4">
            Discount: ₦{item.priceDiscounted.toLocaleString()}
          </p>
        )}

        {/* Add to Cart */}
        <div className="flex justify-end gap-3 flex-wrap">
          <button
            onClick={() => handleAddToCart(item)}
            disabled={loadingItemId === item.id}
            className={`px-4 py-2 rounded text-white ${
              loadingItemId === item.id
                ? "bg-gray-400 cursor-not-allowed"
                : "bg-red-600 hover:bg-red-700"
            }`}
          >
            {loadingItemId === item.id ? "Adding..." : "Add to Cart"}
          </button>
        </div>
      </div>
    </div>
  );
}

import React from "react";
import { motion } from "framer-motion";

const CategoryModal = ({ onClose, onSelectCategory }) => {
  // ✅ Your categories (UPDATED: Jewellery and watches -> Furniture)
  const categories = [
    "Household appliances",
    "Perfume",
    "Back to school",
    "Kids wear & essentials",
    "Ladies wear",
    "Furniture",
    "Bags and luggage",
    "Fashion items",
    "Electronics & gadget",
    "Hairs",
  ];

  // Simple fallback image for all (you can replace per category later)
  const defaultImage =
    "https://images.unsplash.com/photo-1512436991641-6745cdb1723f?auto=format&fit=crop&w=800&q=60";

  // 🧠 Handle click: update category + close modal + navigate (like Navbar)
  const handleSelect = (cat) => {
    onSelectCategory(cat);
    onClose();

    // ✅ This mimics the Navbar routing/scrolling style
    const target = document.getElementById("cookingitems");
    if (target) {
      const offset = 100;
      const top = target.getBoundingClientRect().top + window.scrollY - offset;
      window.scrollTo({ top, behavior: "smooth" });
    } else {
      // fallback redirect if section not in current view
      window.location.href = "/#cookingitems";
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-40 z-[100] flex items-center justify-center">
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white rounded-2xl w-full max-w-md max-h-[85vh] overflow-y-auto p-4 relative"
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-2 right-3 text-gray-500 hover:text-gray-700 text-lg"
        >
          ✕
        </button>

        <h2 className="text-lg font-bold text-gray-800 mb-4 text-center">
          Select a Category
        </h2>

        {/* Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {categories.map((cat, index) => (
            <motion.div
              key={index}
              whileHover={{ scale: 1.03 }}
              onClick={() => handleSelect(cat)}
              className="bg-gray-50 rounded-xl overflow-hidden cursor-pointer hover:shadow-md transition"
            >
              <img
                src={defaultImage}
                alt={cat}
                className="w-full h-40 object-cover"
              />
              <div className="text-center p-2">
                <h3 className="font-semibold text-gray-800">{cat}</h3>
                <p className="text-red-600 text-sm font-medium">SHOP NOW →</p>
              </div>
            </motion.div>
          ))}
        </div>
      </motion.div>
    </div>
  );
};

export default CategoryModal;

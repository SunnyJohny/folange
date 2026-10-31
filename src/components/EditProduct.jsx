import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  doc,
  getDoc,
  updateDoc,
  arrayUnion,
  increment,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytesResumable } from "firebase/storage";
import { db, storage } from "../firebase";
import { toast } from "react-toastify";

/**
 * EditProductModal
 *
 * Renders the Edit Product UI as a modal overlay using a portal to document.body
 * Route: /admin/edit-product/:id
 *
 * Behavior:
 * - If location.state?.item is present it uses it as initial data (fast path).
 * - Otherwise it fetches the product by :id from Firestore.
 * - Allows updating fields, uploading a new main image and color images.
 * - Supports restockAmount to increment product quantity and append restockHistory.
 *
 * The modal cleans up by navigating back on close.
 */
export default function EditProductModal() {
  const { id: paramId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();

  const initial = location.state?.item || null;

  const [loading, setLoading] = useState(false);
  const [item, setItem] = useState(
    initial || {
      id: paramId || null,
      name: "",
      description: "",
      priceOriginal: "",
      priceDiscounted: "",
      shipmentFee: "",
      image: null,
      category: "",
      sizes: [],
      colors: [],
      colorImages: {},
      available: true,
      status: "Available",
      trackingStage: "Pending",
      quantity: 0,
      restockAmount: 0,
    }
  );

  const [colorFiles, setColorFiles] = useState({});
  const [mainImageFile, setMainImageFile] = useState(null);

  useEffect(() => {
    let mounted = true;
    if (!initial && paramId) {
      (async () => {
        setLoading(true);
        try {
          const snap = await getDoc(doc(db, "cookingitems", paramId));
          if (!snap.exists()) {
            toast.error("Product not found");
            navigate(-1);
            return;
          }
          const data = { id: snap.id, ...snap.data() };
          data.sizes = data.sizes || [];
          data.colors = data.colors || [];
          data.colorImages = data.colorImages || {};
          if (mounted) {
            setItem({
              ...data,
              restockAmount: 0,
            });
          }
        } catch (err) {
          console.error("Failed to load product:", err);
          toast.error("Failed to load product");
          navigate(-1);
        } finally {
          setLoading(false);
        }
      })();
    }
    return () => (mounted = false);
  }, [initial, paramId, navigate]);

  const getName = (maybeObjOrString) =>
    typeof maybeObjOrString === "string"
      ? maybeObjOrString
      : maybeObjOrString?.name ?? null;

  const handleInputChange = (e) => {
    const { name, value, type, checked, files } = e.target;
    if (name === "image") {
      setMainImageFile(files?.[0] || null);
      // keep existing URL in item.image until uploaded
    } else if (name && name.startsWith("color-file-")) {
      const cname = name.replace("color-file-", "");
      setColorFiles((prev) => ({ ...prev, [cname]: files?.[0] || null }));
    } else if (type === "checkbox") {
      setItem((prev) => ({ ...prev, [name]: checked }));
    } else {
      setItem((prev) => ({ ...prev, [name]: value }));
    }
  };

  const addSize = (sizeName) => {
    if (!sizeName || !sizeName.trim()) return;
    const s = sizeName.trim();
    if ((item.sizes || []).some((x) => getName(x) === s)) return;
    setItem((prev) => ({
      ...prev,
      sizes: [...(prev.sizes || []), { name: s, priceOriginal: "", priceDiscounted: "" }],
    }));
  };

  const addColor = (colorName) => {
    if (!colorName || !colorName.trim()) return;
    const c = colorName.trim();
    if ((item.colors || []).some((x) => getName(x) === c)) return;
    setItem((prev) => ({
      ...prev,
      colors: [...(prev.colors || []), { name: c, priceOriginal: "", priceDiscounted: "" }],
      colorImages: { ...(prev.colorImages || {}), [c]: prev.colorImages?.[c] || null },
    }));
  };

  const removeColor = (name) => {
    setItem((prev) => {
      const nextColors = (prev.colors || []).filter((c) => getName(c) !== name);
      const imgs = { ...(prev.colorImages || {}) };
      delete imgs[name];
      return { ...prev, colors: nextColors, colorImages: imgs };
    });
    setColorFiles((prev) => {
      const c = { ...prev };
      delete c[name];
      return c;
    });
  };

  const uploadFile = async (filePath, file) => {
    const r = ref(storage, filePath);
    await uploadBytesResumable(r, file);
    const url = await getDownloadURL(r);
    return url;
  };

  const handleSave = async () => {
    if (!item.name?.trim() || !item.description?.trim()) {
      toast.error("Please provide name and description");
      return;
    }

    setLoading(true);
    try {
      let mainImageUrl = item.image || null;
      if (mainImageFile instanceof File) {
        const fp = `cookingitems/${Date.now()}_${mainImageFile.name}`;
        mainImageUrl = await uploadFile(fp, mainImageFile);
      }

      const finalColorImages = { ...(item.colorImages || {}) };
      for (const [color, file] of Object.entries(colorFiles || {})) {
        if (!file) continue;
        const fp = `cookingitems/colorImages/${Date.now()}_${color}_${file.name}`;
        const url = await uploadFile(fp, file);
        finalColorImages[color] = url;
      }

      const payload = {
        name: item.name,
        description: item.description,
        priceOriginal: item.priceOriginal || "",
        priceDiscounted: item.priceDiscounted || "",
        shipmentFee: item.shipmentFee ?? null,
        category: item.category || "",
        available: !!item.available,
        sizes: item.sizes || [],
        colors: item.colors || [],
        colorImages: finalColorImages,
        status: item.status || "Available",
        trackingStage: item.trackingStage || "Pending",
        image: mainImageUrl,
      };

      const restockAmount = parseInt(item.restockAmount || 0, 10);
      const docRef = doc(db, "cookingitems", item.id || paramId);

      if (restockAmount > 0) {
        await updateDoc(docRef, {
          ...payload,
          quantity: increment(restockAmount),
          restockHistory: arrayUnion({
            id: crypto.randomUUID(),
            quantity: restockAmount,
            timestamp: new Date(),
            adminId: currentUser?.uid || "admin",
          }),
        });
      } else {
        await updateDoc(docRef, payload);
      }

      toast.success("Product updated");
      navigate(-1);
    } catch (err) {
      console.error("Update failed:", err);
      toast.error("Update failed");
    } finally {
      setLoading(false);
    }
  };

  const onClose = () => navigate(-1);

  // render modal content
  const modalContent = (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[99999] flex items-center justify-center p-4"
    >
      <div
        className="absolute inset-0 bg-black bg-opacity-50"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative bg-white rounded-lg shadow-lg w-full max-w-3xl max-h-[90vh] overflow-y-auto p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold">{item.name || "Edit Product"}</h2>
          <button
            onClick={onClose}
            className="text-gray-700 bg-gray-200 hover:bg-gray-300 px-3 py-1 rounded"
          >
            Close
          </button>
        </div>

        <div className="space-y-3">
          <input
            name="name"
            value={item.name}
            onChange={handleInputChange}
            placeholder="Product Name"
            className="w-full border px-3 py-2 rounded"
          />

          <textarea
            name="description"
            value={item.description}
            onChange={handleInputChange}
            placeholder="Description"
            className="w-full border px-3 py-2 rounded"
          />

          <div className="grid grid-cols-2 gap-2">
            <input
              name="priceOriginal"
              value={item.priceOriginal}
              onChange={handleInputChange}
              placeholder="Original price"
              className="border px-3 py-2 rounded"
            />
            <input
              name="priceDiscounted"
              value={item.priceDiscounted}
              onChange={handleInputChange}
              placeholder="Discounted price"
              className="border px-3 py-2 rounded"
            />
          </div>

          <input
            name="shipmentFee"
            value={item.shipmentFee ?? ""}
            onChange={handleInputChange}
            placeholder="Shipment Fee"
            className="w-full border px-3 py-2 rounded"
          />

          <div>
            <label className="block mb-1">Main image</label>
            <input name="image" type="file" onChange={handleInputChange} />
            {item.image && typeof item.image === "string" && (
              <img src={item.image} alt="preview" className="w-32 h-32 object-cover mt-2 rounded" />
            )}
          </div>

          <div>
            <label className="block mb-1">Category</label>
            <input name="category" value={item.category} onChange={handleInputChange} className="w-full border px-3 py-2 rounded" />
          </div>

          <div>
            <label className="block mb-1">Colors</label>
            <div className="flex gap-2 mb-2">
              <input id="new-color-modal" placeholder="color name or hex" className="flex-1 border px-3 py-2 rounded" />
              <button
                type="button"
                className="bg-green-600 text-white px-3 rounded"
                onClick={() => {
                  const el = document.getElementById("new-color-modal");
                  addColor(el.value);
                  el.value = "";
                }}
              >
                Add
              </button>
            </div>

            <div className="space-y-2">
              {(item.colors || []).map((c) => {
                const name = getName(c);
                return (
                  <div key={name} className="flex items-center gap-2">
                    <div className="flex-1">{name}</div>
                    {item.colorImages?.[name] && <img src={item.colorImages[name]} alt={name} className="w-12 h-12 object-cover rounded" />}
                    <input name={`color-file-${name}`} type="file" onChange={handleInputChange} />
                    <button className="px-2 py-1 bg-red-500 text-white rounded" onClick={() => removeColor(name)}>
                      Remove
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <label className="block mb-1">Sizes</label>
            <div className="flex gap-2 mb-2">
              <input id="new-size-modal" placeholder="size name (S, M, L)" className="flex-1 border px-3 py-2 rounded" />
              <button
                type="button"
                className="bg-green-600 text-white px-3 rounded"
                onClick={() => {
                  const el = document.getElementById("new-size-modal");
                  addSize(el.value);
                  el.value = "";
                }}
              >
                Add
              </button>
            </div>

            <div className="space-y-2">
              {(item.sizes || []).map((s) => {
                const name = getName(s);
                return (
                  <div key={name} className="flex items-center gap-2">
                    <div className="w-32">{name}</div>
                    <input
                      placeholder="orig"
                      className="border px-2 py-1 w-28"
                      value={s.priceOriginal || ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        setItem((prev) => ({ ...prev, sizes: prev.sizes.map((sz) => (getName(sz) === name ? { ...sz, priceOriginal: v } : sz)) }));
                      }}
                    />
                    <input
                      placeholder="disc"
                      className="border px-2 py-1 w-28"
                      value={s.priceDiscounted || ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        setItem((prev) => ({ ...prev, sizes: prev.sizes.map((sz) => (getName(sz) === name ? { ...sz, priceDiscounted: v } : sz)) }));
                      }}
                    />
                  </div>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="flex items-center gap-2">
              <input type="checkbox" name="available" checked={!!item.available} onChange={handleInputChange} /> Available
            </label>
            <select name="status" value={item.status} onChange={handleInputChange} className="border px-3 py-2 rounded">
              <option value="Available">Available</option>
              <option value="Coming Soon">Coming Soon</option>
              <option value="Pre-Order">Pre-Order</option>
            </select>
          </div>

          <div>
            <label className="block mb-1">Restock Amount (enter &gt;0 to add)</label>
            <input name="restockAmount" value={item.restockAmount || ""} onChange={handleInputChange} type="number" className="border px-3 py-2 rounded w-40" />
          </div>

          <div>
            <label className="block mb-1">Tracking Stage</label>
            <input name="trackingStage" value={item.trackingStage} onChange={handleInputChange} className="border px-3 py-2 rounded w-full" />
          </div>

          <div className="flex gap-2">
            <button className="bg-blue-600 text-white px-4 py-2 rounded" onClick={handleSave} disabled={loading}>
              {loading ? "Saving..." : "Save"}
            </button>
            <button className="bg-gray-300 px-4 py-2 rounded" onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  // render portal into document.body so it's above all app structure (and respects z-index)
  return ReactDOM.createPortal(modalContent, document.body);
}
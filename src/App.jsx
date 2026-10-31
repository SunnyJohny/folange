
import React from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import "./App.css";

// Main components
import AboutUs from "./components/About";
import Contact from "./components/Contact";
import Footer from "./components/Footer";
import Hero from "./components/Hero";
import Navbar from "./components/Navbar";
import Dishes from "./components/FoodDisplay";
import Academy from "./components/Academy";
import CookingItemDetail from "./components/CookingItemDetail";
import BottomNav from "./components/BottomNav";
import HomeCategorySlider from "./components/HomeCategorySlider";
import CheckoutPage from "./components/CheckoutPage";
import PaymentPage from "./components/PaymentPage";
import PaymentCallback from "./components/PaymentCallback";
import CredentialsModal from "./components/CredentialsModal";
import FAQ from "./components/FAQ";
import { useMyContext } from "./Context/MyContext";

// Admin / Inventory pages
import InventoryPage from "./components/InventoryPage";
import EditProduct from "./components/EditProduct";

// Public shareable product detail page
import PublicItemDetail from "./components/PublicItemDetail";

// Public gallery and gallery management
import Gallery from "./components/Gallery";
import GalleryManager from "./components/GalleryManager";

function App() {
  const { showCredentialsModal, newAccount, closeCredentialsModal } =
    useMyContext();

  const handleBottomNavClick = (tab) => {
    console.log("Navigating to:", tab);

    const sectionMap = {
      category: "cookingitems",
      preorder: "orders",
      available: "services",
      wishlist: "testimonials",
      faq: "faq",
    };

    const sectionId = sectionMap[tab];

    if (sectionId) {
      const section = document.getElementById(sectionId);

      if (section) {
        const header = document.querySelector("header");
        const headerHeight = header?.getBoundingClientRect().height || 80;

        const top =
          section.getBoundingClientRect().top +
          window.scrollY -
          headerHeight -
          12;

        window.scrollTo({
          top: Math.max(top, 0),
          behavior: "smooth",
        });
      } else {
        console.warn(
          `Bottom navigation target with id "${sectionId}" was not found.`
        );
      }
    }
  };

  return (
    <Router>
      {/* Persistent navigation */}
      <Navbar />

      <Routes>
        {/* ================= HOME ================= */}
        <Route
          path="/"
          element={
            <div className="bg-[#FFFCF7] pt-28 pb-20">
              {/* Hero section */}
              <Hero />

              {/* Homepage categories */}
              <HomeCategorySlider />

              {/* Folange Beauty Store */}
              <Dishes />

              {/* Folange Beauty Academy */}
              <Academy />

              {/* Public Folange Gallery */}
              <Gallery />

              {/* About Folange */}
              <AboutUs />

              {/* FAQ Section */}
              <section id="faq" className="scroll-mt-24">
                <FAQ />
              </section>

              {/* Contact section */}
              <Contact />

              {/* Footer */}
              <Footer />
            </div>
          }
        />

        {/* ================= PRODUCT DETAILS ================= */}

        {/* Public shareable product page */}
        <Route
          path="/item/:id"
          element={<PublicItemDetail />}
        />

        {/* Internal product details */}
        <Route
          path="/product/:itemId"
          element={<CookingItemDetail />}
        />

        {/* ================= CHECKOUT ================= */}
        <Route
          path="/checkout"
          element={<CheckoutPage />}
        />

        {/* ================= PAYMENT ================= */}
        <Route
          path="/payment"
          element={<PaymentPage />}
        />

        {/* Payment callback */}
        <Route
          path="/payment/callback"
          element={<PaymentCallback />}
        />

        {/* Temporary payment callback test route */}
        <Route
          path="/payment/callback/test"
          element={<PaymentCallback />}
        />

        {/* ================= INVENTORY & ADMIN ================= */}

        <Route
          path="/inventory"
          element={<InventoryPage />}
        />

        <Route
          path="/admin/edit-product/:id"
          element={<EditProduct />}
        />

        {/* ================= GALLERY MANAGEMENT ================= */}

        {/* Retain the existing gallery upload/manage page */}
        <Route
          path="/gallery"
          element={<GalleryManager />}
        />
      </Routes>

      {/* Bottom navigation */}
      <BottomNav onNavigate={handleBottomNavClick} />

      {/* Credentials modal */}
      <CredentialsModal
        show={showCredentialsModal}
        email={newAccount?.email}
        password={newAccount?.password}
        onClose={closeCredentialsModal}
        onContinue={() => {
          closeCredentialsModal();
          window.location.href = "/checkout";
        }}
      />
    </Router>
  );
}

export default App;

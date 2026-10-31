import React from "react";
import { Swiper, SwiperSlide } from "swiper/react";
import { Autoplay } from "swiper/modules";
import { motion } from "framer-motion";
import {
  Brush,
  Droplets,
  FlaskConical,
  Flower2,
  Gift,
  Heart,
  Scissors,
  Sparkles,
  Sun,
} from "lucide-react";
import { useMyContext } from "../Context/MyContext";
import "swiper/css";
import "swiper/css/autoplay";

const categories = [
  { name: "Cleansers & Soaps", icon: Droplets },
  { name: "Serums & Treatments", icon: FlaskConical },
  { name: "Moisturisers & Creams", icon: Sparkles },
  { name: "Sunscreen", icon: Sun },
  { name: "Body Care", icon: Heart },
  { name: "Hair Care", icon: Scissors },
  { name: "Makeup", icon: Brush },
  { name: "Fragrances", icon: Flower2 },
  { name: "Beauty Tools & Accessories", icon: Sparkles },
  { name: "Gift Sets & Bundles", icon: Gift },
];

const HomeCategorySlider = () => {
  const {
    setFilterCategory,
    setStatusFilter,
    currentCategory,
    setCurrentCategory,
  } = useMyContext();

  const handleSelect = (category) => {
    setStatusFilter("All");
    setFilterCategory(category);
    setCurrentCategory(category);

    const target = document.getElementById("cookingitems");

    if (target) {
      const offset = 100;
      const top =
        target.getBoundingClientRect().top + window.scrollY - offset;

      window.scrollTo({
        top,
        behavior: "smooth",
      });
    }
  };

  const getCategoryButtonClass = (category) =>
    `group flex w-full flex-col items-center justify-center rounded-2xl border p-4 text-center transition-all duration-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9A7428] ${
      currentCategory === category
        ? "border-[#D4AF37] bg-[#F8F0DE] shadow-sm"
        : "border-[#E7D8B8] bg-[#FFFEFA] hover:border-[#D4AF37] hover:bg-[#F8F0DE]/70 hover:shadow-md"
    }`;

  return (
    <section
      aria-labelledby="folange-categories-title"
      className="mx-auto w-full max-w-6xl px-4 py-6 text-[#3F3528] sm:px-6"
    >
      <div className="mb-4">
        <p className="mb-1 text-xs font-semibold uppercase tracking-[0.25em] text-[#8A6517]">
          Folange Beauty Lounge
        </p>
        <h2
          id="folange-categories-title"
          className="text-2xl sm:text-3xl"
          style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}
        >
          Explore Beauty Categories
        </h2>
      </div>

      <div className="rounded-2xl border border-[#E7D8B8] bg-[#FFFEFA] py-4 shadow-sm">
        <Swiper
          modules={[Autoplay]}
          slidesPerView={2}
          centeredSlides
          spaceBetween={12}
          autoplay={{
            delay: 3000,
            disableOnInteraction: false,
          }}
          speed={800}
          loop
          breakpoints={{
            480: { slidesPerView: 3, spaceBetween: 16 },
            768: { slidesPerView: 4, spaceBetween: 16 },
            1024: { slidesPerView: 5, spaceBetween: 20 },
          }}
          className="!overflow-hidden px-4 sm:px-6"
        >
          {categories.map(({ name, icon: Icon }) => (
            <SwiperSlide key={name}>
              <button
                type="button"
                onClick={() => handleSelect(name)}
                aria-pressed={currentCategory === name}
                className={`${getCategoryButtonClass(name)} mx-auto min-h-28 max-w-40`}
              >
                <Icon
                  aria-hidden="true"
                  className={`mb-2 h-8 w-8 transition-colors ${
                    currentCategory === name
                      ? "text-[#8A6517]"
                      : "text-[#A88A4A] group-hover:text-[#8A6517]"
                  }`}
                  strokeWidth={1.6}
                />
                <span className="text-xs font-semibold leading-4 text-[#3F3528] sm:text-sm">
                  {name}
                </span>
              </button>
            </SwiperSlide>
          ))}
        </Swiper>
      </div>

      <div className="mt-7">
        <div className="mb-3 flex items-center justify-between border-b border-[#E7D8B8] pb-2">
          <h3
            className="text-xl text-[#3F3528]"
            style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}
          >
            Shop by category
          </h3>
          <span className="text-xs font-medium text-[#7D7262]">
            {currentCategory || "All beauty products"}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-5">
          {categories.map(({ name, icon: Icon }) => (
            <motion.button
              key={name}
              type="button"
              whileHover={{ y: -3 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => handleSelect(name)}
              aria-pressed={currentCategory === name}
              className={getCategoryButtonClass(name)}
            >
              <Icon
                aria-hidden="true"
                className={`mb-3 h-9 w-9 ${
                  currentCategory === name
                    ? "text-[#8A6517]"
                    : "text-[#A88A4A]"
                }`}
                strokeWidth={1.6}
              />
              <span className="text-sm font-semibold leading-5 text-[#3F3528]">
                {name}
              </span>
              <span className="mt-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#8A6517]">
                Shop now
              </span>
            </motion.button>
          ))}
        </div>
      </div>
    </section>
  );
};

export default HomeCategorySlider;

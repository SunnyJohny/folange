
import React from "react";
import { motion } from "framer-motion";
import {
  FaSpa,
  FaShoppingBag,
  FaGraduationCap,
  FaHeart,
  FaGem,
} from "react-icons/fa";
import { useMyContext } from "../Context/MyContext";

const servicesData = [
  {
    icon: FaShoppingBag,
    title: "Beauty & Cosmetic Products",
    description:
      "Discover beauty and cosmetic products carefully selected to complement your personal beauty routine.",
  },
  {
    icon: FaSpa,
    title: "Massage & Spa Treatments",
    description:
      "Unwind with a massage or spa treatment. Contact us to ask about available services and appointment times.",
    bookingMessage:
      "Hello Folange Beauty Lounge, I would like to book a massage or spa treatment. Please share available services and appointment times.",
  },
  {
    icon: FaHeart,
    title: "Skincare & Facial Care",
    description:
      "Explore skincare essentials designed to support your daily skincare routine and help you care for your skin.",
  },
  {
    icon: FaGem,
    title: "Makeup & Beauty Essentials",
    description:
      "Find makeup and beauty essentials for everyday wear, special occasions, and your personal style.",
  },
  {
    icon: FaGraduationCap,
    title: "Beauty Academy",
    description:
      "Explore beauty training opportunities to develop practical skills and build confidence in the beauty industry.",
  },
  {
    icon: FaHeart,
    title: "Personal Beauty Care",
    description:
      "Discover products and beauty essentials suited to your preferences, needs, and personal care routine.",
  },
];

const iconAnimations = [
  {
    x: [0, -8, 8, -8, 8, 0],
    transition: { repeat: Infinity, duration: 2.5 },
  },
  {
    y: [0, -8, 0],
    transition: { repeat: Infinity, duration: 1.8 },
  },
  {
    scale: [1, 1.12, 1],
    transition: { repeat: Infinity, duration: 2 },
  },
  {
    rotate: [0, 8, -8, 8, -8, 0],
    transition: { repeat: Infinity, duration: 2.5 },
  },
  {
    opacity: [0.75, 1, 0.75],
    y: [0, -5, 0],
    transition: { repeat: Infinity, duration: 2.2 },
  },
];

const AboutUs = () => {
  const { comments } = useMyContext();

  return (
    <section
      id="about"
      className="bg-[#FFFCF7] px-5 py-14 text-[#493723] md:px-20"
    >
      {/* Title Section */}
      <div className="mb-12 text-center">
        <p className="mb-3 text-sm font-semibold uppercase tracking-[0.25em] text-[#8A6517]">
          Welcome to Folange
        </p>

        <h2 className="mb-4 text-3xl font-extrabold tracking-tight text-[#493723] md:text-4xl">
          About Folange Beauty Lounge
        </h2>

        <p className="text-sm text-[#8C8171]">
          Home &gt;{" "}
          <span className="font-bold text-[#8A6517]">About Us</span>
        </p>

        <div className="mx-auto mt-5 h-1 w-20 rounded-full bg-[#D4AF37]" />
      </div>

      {/* Main Information Section */}
      <div className="mb-16 grid items-center gap-10 lg:grid-cols-2">
        {/* Brand Image */}
        <div className="overflow-hidden rounded-2xl border border-[#D4AF37]/25 bg-white p-3 shadow-lg">
          <img
            src="/images/Folange%20Beauty%20Lounge%20logo.png"
            alt="Folange Beauty Lounge"
            className="h-auto max-h-[420px] w-full rounded-xl object-contain"
            loading="lazy"
          />
        </div>

        {/* Description */}
        <div>
          <p className="mb-6 text-lg leading-relaxed text-[#6D5A45]">
            <strong className="text-[#8A6517]">
              Folange Beauty Lounge
            </strong>{" "}
            is a beauty, wellness, and spa destination dedicated to cosmetics,
            skincare, makeup, personal beauty care, and relaxation. We aim to
            provide a welcoming experience where customers can discover beauty
            essentials and explore services that complement their individual
            beauty and wellness needs.
          </p>

          <p className="mb-6 text-lg leading-relaxed text-[#6D5A45]">
            Through our online store, spa and wellness offerings, and beauty
            academy, we bring together beauty products, self-care experiences,
            and learning opportunities in one place. Whether you are refreshing
            your personal collection, exploring spa and wellness services, or
            developing your beauty skills, Folange is here to support your
            journey.
          </p>

          <p className="text-lg font-semibold italic text-[#8A6517]">
            Your Beauty. Your Confidence. Your Style.
          </p>

          <div className="mt-7 flex flex-wrap gap-3">
            <span className="rounded-full border border-[#D4AF37]/40 bg-white px-4 py-2 text-sm font-medium text-[#6D501C]">
              Beauty Essentials
            </span>

            <span className="rounded-full border border-[#D4AF37]/40 bg-white px-4 py-2 text-sm font-medium text-[#6D501C]">
              Skincare
            </span>

            <span className="rounded-full border border-[#D4AF37]/40 bg-white px-4 py-2 text-sm font-medium text-[#6D501C]">
              Spa & Wellness
            </span>

            <span className="rounded-full border border-[#D4AF37]/40 bg-white px-4 py-2 text-sm font-medium text-[#6D501C]">
              Beauty Academy
            </span>
          </div>
        </div>
      </div>

      {/* Services Section */}
      <div id="services" className="mb-16 scroll-mt-28">
        <div className="mb-10 text-center">
          <p className="mb-2 text-sm font-semibold uppercase tracking-[0.2em] text-[#8A6517]">
            What We Offer
          </p>

          <h2 className="mb-4 text-3xl font-bold text-[#493723]">
            Our Beauty, Wellness & Spa Services
          </h2>

          <p className="mx-auto max-w-2xl leading-relaxed text-[#8C8171]">
            Discover the Folange experience, bringing together beauty
            essentials, skincare, spa and wellness offerings, personal care,
            and learning opportunities in one destination.
          </p>

          <div className="mx-auto mt-4 h-1 w-16 rounded-full bg-[#D4AF37]" />
        </div>

        <div className="grid grid-cols-1 gap-7 sm:grid-cols-2 lg:grid-cols-3">
          {servicesData.map((service, index) => {
            const IconComponent = service.icon;

            return (
              <motion.div
                key={service.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.2 }}
                transition={{ duration: 0.45, delay: index * 0.08 }}
                className="group rounded-2xl border border-[#D4AF37]/20 bg-gradient-to-b from-white to-[#F9F1E3] p-7 text-center shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-[#D4AF37]/60 hover:shadow-xl"
              >
                <motion.div
                  className="mb-5 flex justify-center"
                  animate={iconAnimations[index % iconAnimations.length]}
                >
                  <div className="flex h-16 w-16 items-center justify-center rounded-full border border-[#D4AF37]/30 bg-[#F7EAC8] transition-colors duration-300 group-hover:bg-[#D4AF37]">
                    <IconComponent
                      size={30}
                      className="text-[#8A6517] transition-colors duration-300 group-hover:text-white"
                    />
                  </div>
                </motion.div>

                <h3 className="mb-3 text-xl font-bold text-[#493723]">
                  {service.title}
                </h3>

                <p className="leading-relaxed text-[#796B59]">
                  {service.description}
                </p>

                {service.bookingMessage && (
                  <a
                    href={`https://wa.me/2348066044777?text=${encodeURIComponent(service.bookingMessage)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-5 inline-flex items-center justify-center rounded-md border border-[#D4AF37] bg-[#D4AF37] px-4 py-2 text-sm font-semibold text-[#3F3528] transition hover:bg-[#E7C65C]"
                  >
                    Book an Appointment
                  </a>
                )}
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* Vision and Mission Section */}
      <div className="rounded-3xl border border-[#D4AF37]/20 bg-white p-6 shadow-sm md:p-10">
        <div className="mb-10 text-center">
          <p className="mb-2 text-sm font-semibold uppercase tracking-[0.2em] text-[#8A6517]">
            Our Purpose
          </p>

          <h3 className="text-2xl font-extrabold uppercase tracking-wide text-[#493723] md:text-3xl">
            Our Vision & Mission
          </h3>

          <div className="mx-auto mt-4 h-1 w-20 rounded-full bg-[#D4AF37]" />
        </div>

        <div className="grid gap-8 md:grid-cols-2">
          {/* Vision */}
          <div className="rounded-2xl border-l-4 border-[#D4AF37] bg-gradient-to-br from-[#FFF9EA] to-white p-6 shadow-sm">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#F7EAC8]">
                <FaGem className="text-xl text-[#8A6517]" />
              </div>

              <h4 className="text-2xl font-bold text-[#493723]">
                Our Vision
              </h4>
            </div>

            <p className="text-lg leading-relaxed text-[#6D5A45]">
              To become a trusted beauty, wellness, and spa destination known
              for providing quality beauty essentials, welcoming self-care
              experiences, and opportunities for people to explore and develop
              their beauty skills.
            </p>
          </div>

          {/* Mission */}
          <div className="rounded-2xl border-l-4 border-[#8A6517] bg-gradient-to-br from-[#F9F1E3] to-white p-6 shadow-sm">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#F7EAC8]">
                <FaHeart className="text-xl text-[#8A6517]" />
              </div>

              <h4 className="text-2xl font-bold text-[#493723]">
                Our Mission
              </h4>
            </div>

            <p className="text-lg leading-relaxed text-[#6D5A45]">
              To provide a welcoming beauty and wellness experience through
              carefully presented products, spa and self-care offerings,
              useful beauty resources, and opportunities for skills
              development.
            </p>
          </div>
        </div>
      </div>

      {/* Testimonials Section — retained for future use
      <div id="testimonials" className="mt-16">
        <h3 className="m-8 text-center text-2xl font-bold uppercase tracking-wide text-[#493723]">
          What Our Clients Say
        </h3>

        {comments.length === 0 ? (
          <p className="text-center text-[#8C8171]">
            No testimonials yet.
          </p>
        ) : (
          <div className="mb-12 grid gap-8 md:grid-cols-2 lg:grid-cols-3">
            {comments.map((comment, index) => (
              <div
                key={comment.id || index}
                className="rounded-2xl border border-[#D4AF37]/20 bg-white p-6 shadow-md"
              >
                <img
                  src={comment.photoURL || "/images/default-user.jpg"}
                  alt={comment.name || "Anonymous"}
                  className="mb-4 h-16 w-16 rounded-full object-cover"
                />

                <p className="mb-4 italic text-[#6D5A45]">
                  “{comment.text}”
                </p>

                <h4 className="text-lg font-semibold text-[#493723]">
                  {comment.name || "Anonymous"}
                </h4>

                {comment.phone && (
                  <p className="text-sm text-[#8C8171]">
                    Phone: {comment.phone}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      */}
    </section>
  );
};

export default AboutUs;


import React from "react";
import {
  FaWhatsapp,
  FaFacebook,
  FaInstagram,
} from "react-icons/fa";

const socialMediaLinks = [
  {
    name: "WhatsApp",
    icon: <FaWhatsapp />,
    url: "https://wa.me/2348066044777?text=Hello%20Folange%20Beauty%20Lounge%2C%20I%20would%20like%20to%20make%20an%20inquiry.",
  },
  {
    name: "Facebook",
    icon: <FaFacebook />,
    url: "https://www.facebook.com/folangebeautyacademy/",
  },
  {
    name: "Instagram",
    icon: <FaInstagram />,
    url: "https://www.instagram.com/folange_beauty_academy/",
  },
];

const quickLinks = [
  { link: "Home", path: "home" },
  { link: "Store", path: "store" },
  { link: "Academy", path: "academy" },
  { link: "Gallery", path: "gallery" },
  { link: "FAQ", path: "faq" },
  { link: "Contact", path: "contact" },
];

const handleScrollAdjust = (event, path) => {
  event.preventDefault();

  const target = document.getElementById(path);

  if (!target) {
    console.warn(
      `Navigation target with id "${path}" was not found.`
    );
    return;
  }

  const header = document.querySelector("header");
  const offset = header?.offsetHeight || 100;

  const top =
    target.getBoundingClientRect().top +
    window.pageYOffset -
    offset -
    12;

  window.scrollTo({
    top: Math.max(top, 0),
    behavior: "smooth",
  });

  try {
    window.history.replaceState(null, "", `#${path}`);
  } catch {
    // Ignore URL update errors.
  }
};

const Footer = () => {
  return (
    <footer className="bg-gradient-to-br from-[#FFFCF7] via-[#F5EBD9] to-[#E8D7B8] text-[#493723] py-12 px-4 md:px-8">
      <div className="container mx-auto max-w-7xl">

        <div className="flex flex-col lg:flex-row justify-between items-center lg:items-start gap-10">

          {/* Brand */}
          <div className="text-center lg:text-left max-w-md">

            <h2 className="text-3xl md:text-4xl font-bold tracking-wide font-serif text-[#6F5012]">
              FOLANGE
            </h2>

            <p className="text-sm font-semibold tracking-[0.2em] uppercase text-[#A17A28] mt-2">
              Beauty Lounge
            </p>

            <p className="text-[#8A6517] mt-4 font-medium">
              Your Beauty. Your Confidence. Your Style.
            </p>

            <p className="text-sm text-[#756653] mt-4 leading-7">
              Welcome to Folange Beauty Lounge, your destination for
              beauty, wellness, cosmetics, and beauty education.
              Explore our Store, discover learning opportunities
              through Folange Academy, and experience our world
              of beauty and style.
            </p>

            <p className="text-xs tracking-widest uppercase text-[#A17A28] mt-5">
              Beauty · Wellness · Education
            </p>

          </div>

          {/* Quick Links */}
          <div className="text-center">

            <h2 className="text-xl font-bold mb-5 font-serif text-[#493723]">
              Quick Links
            </h2>

            <ul className="flex flex-wrap justify-center gap-x-6 gap-y-4">
              {quickLinks.map(({ link, path }) => (
                <li key={path}>
                  <a
                    href={`#${path}`}
                    onClick={(event) =>
                      handleScrollAdjust(event, path)
                    }
                    className="relative inline-block pb-1 text-[#756653] hover:text-[#8A6517] cursor-pointer transition-colors duration-300 after:absolute after:left-0 after:-bottom-0.5 after:h-[2px] after:w-0 after:bg-[#D4AF37] after:transition-all after:duration-300 hover:after:w-full"
                  >
                    {link}
                  </a>
                </li>
              ))}
            </ul>

          </div>

          {/* Social and Contact */}
          <div className="text-center lg:text-right">

            <h2 className="text-xl font-bold mb-5 font-serif text-[#493723]">
              Connect With Us
            </h2>

            <div className="flex justify-center lg:justify-end gap-6 text-2xl text-[#8A6517]">

              {socialMediaLinks.map((social) => (
                <a
                  key={social.name}
                  href={social.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={social.name}
                  title={social.name}
                  className="hover:text-[#D4AF37] transition-all duration-300 hover:scale-110"
                >
                  {social.icon}
                </a>
              ))}

            </div>

            <div className="mt-6 text-sm text-[#756653] space-y-3">

              <p>
                <a
                  href="tel:+2348066044777"
                  className="hover:text-[#8A6517] hover:underline transition-colors duration-300"
                >
                  <span className="mr-2">📞</span>
                  +234 806 604 4777
                </a>
              </p>

              <p>
                <a
                  href="https://wa.me/2348066044777"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-[#8A6517] hover:underline transition-colors duration-300"
                >
                  <span className="mr-2">💬</span>
                  Chat with us on WhatsApp
                </a>
              </p>

              <p className="leading-6">
                <span className="mr-2">📍</span>
                Festrut Estate, Katampe Road,
                <br />
                Kado, Abuja, FCT, Nigeria.
              </p>

            </div>

          </div>

        </div>

        {/* Bottom Bar */}
        <div className="mt-12 border-t border-[#C6AD7D]/50 pt-6 text-center">

          <p className="text-sm text-[#756653]">
            © {new Date().getFullYear()}{" "}
            <strong className="text-[#8A6517]">
              Folange Beauty Lounge
            </strong>
            . All Rights Reserved.
          </p>

          <p className="text-xs text-[#A17A28] mt-2 italic">
            Beauty · Wellness · Education
          </p>

          <p className="text-xs text-[#8A7860] mt-3">
            Developed by{" "}
            <a
              href="mailto:jayclouddigital@gmail.com"
              className="font-semibold text-[#8A6517] hover:underline"
            >
              Jay Cloud Digital
            </a>
          </p>

        </div>

      </div>
    </footer>
  );
};

export default Footer;

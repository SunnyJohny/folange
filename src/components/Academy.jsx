
import React, { useEffect, useMemo, useState } from "react";
import {
  FaGraduationCap,
  FaPaintBrush,
  FaSpa,
  FaEye,
  FaBriefcase,
  FaArrowRight,
  FaArrowLeft,
  FaCheckCircle,
  FaClock,
  FaUserGraduate,
  FaMoneyBillWave,
  FaBookOpen,
  FaListUl,
  FaTimes,
  FaEdit,
  FaTrash,
  FaPlus,
  FaCreditCard,
  FaInfoCircle,
  FaCertificate,
  FaMapMarkerAlt,
  FaLock,
  FaExclamationTriangle,
} from "react-icons/fa";

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";

import { db } from "../firebase";
import { folangeCollectionPath } from "../config/folangePaths";
import { useMyContext } from "../Context/MyContext";

// ---------------------------------------------------------
// FIRESTORE
// ---------------------------------------------------------

const COURSES_COLLECTION = collection(
  db,
  ...folangeCollectionPath("courses")
);

const DEMO_ENROLMENTS_KEY = "folangeAcademyDemoEnrollments";

// ---------------------------------------------------------
// STARTER COURSES
//
// These courses are examples maintained in this file.
// Courses created by an administrator are stored in Firestore.
// Change these sample prices to the approved course fees.
// ---------------------------------------------------------

const DEFAULT_COURSES = [
  {
    id: "default-makeup-artistry",
    isDefault: true,
    title: "Makeup Artistry",
    category: "MAKEUP & BEAUTY",
    description:
      "Explore makeup techniques, product selection, colour matching, and professional beauty presentation.",
    fullDescription:
      "Develop your understanding of makeup application, product selection, skin preparation, colour matching, and professional presentation. This course is designed for learners interested in developing beauty skills for personal or professional use.",
    duration: "6 weeks",
    eligibility:
      "Open to beginners and anyone interested in makeup artistry. A willingness to learn and practise is recommended.",
    prerequisites:
      "No previous professional makeup experience is required.",
    fee: 75000,
    format: "In-person",
    curriculum: [
      "Introduction to makeup artistry",
      "Skin preparation and hygiene",
      "Understanding skin types and tones",
      "Foundation and concealer application",
      "Colour matching and blending",
      "Eye makeup techniques",
      "Lip application and finishing",
      "Professional presentation and client care",
    ],
    certificate: true,
    isPublished: true,
    enrollmentOpen: true,
    icon: FaPaintBrush,
  },
  {
    id: "default-skincare",
    isDefault: true,
    title: "Skincare & Facial Care",
    category: "SKINCARE",
    description:
      "Learn skincare fundamentals, facial-care routines, product knowledge, and beauty-care practices.",
    fullDescription:
      "Build foundational knowledge of skincare, skin types, cleansing routines, product selection, and facial-care practices. Learn how to approach beauty care responsibly and understand when a client should seek advice from a qualified healthcare professional.",
    duration: "4 weeks",
    eligibility:
      "Suitable for beginners and aspiring beauty professionals interested in skincare.",
    prerequisites:
      "No formal skincare qualification is required.",
    fee: 65000,
    format: "In-person",
    curriculum: [
      "Introduction to skincare",
      "Understanding common skin types",
      "Cleansing and moisturising routines",
      "Skincare product ingredients and labels",
      "Facial-care tools and hygiene",
      "Client consultation basics",
      "Product selection and aftercare",
    ],
    certificate: true,
    isPublished: true,
    enrollmentOpen: true,
    icon: FaSpa,
  },
  {
    id: "default-lash-brow",
    isDefault: true,
    title: "Lash & Brow Styling",
    category: "EYE BEAUTY",
    description:
      "Discover lash and brow styling fundamentals, tools, techniques, and professional presentation.",
    fullDescription:
      "Explore eyebrow shaping, lash and brow presentation, appropriate tools, hygiene, client consultation, and aftercare. Training activities should be conducted according to appropriate safety practices.",
    duration: "3 weeks",
    eligibility:
      "Open to beginners and learners interested in lash and brow beauty services.",
    prerequisites:
      "No previous professional experience is required.",
    fee: 50000,
    format: "In-person",
    curriculum: [
      "Introduction to lash and brow styling",
      "Tools and product knowledge",
      "Hygiene and client preparation",
      "Brow shaping fundamentals",
      "Lash styling fundamentals",
      "Client consultation",
      "Aftercare and professional presentation",
    ],
    certificate: true,
    isPublished: true,
    enrollmentOpen: true,
    icon: FaEye,
  },
  {
    id: "default-beauty-business",
    isDefault: true,
    title: "Beauty Business Essentials",
    category: "BUSINESS & CAREER",
    description:
      "Learn about beauty-business branding, customer service, client relationships, and growing a beauty business.",
    fullDescription:
      "Understand the business skills needed to start or improve a beauty business. Explore branding, service pricing, customer care, social media marketing, record keeping, and building lasting client relationships.",
    duration: "2 weeks",
    eligibility:
      "Suitable for aspiring beauty entrepreneurs, salon owners, and beauty professionals.",
    prerequisites:
      "No formal business qualification is required.",
    fee: 35000,
    format: "Online",
    curriculum: [
      "Introduction to beauty entrepreneurship",
      "Brand identity and positioning",
      "Customer service and client retention",
      "Pricing beauty services",
      "Social media marketing",
      "Basic business record keeping",
      "Growing a beauty business",
    ],
    certificate: true,
    isPublished: true,
    enrollmentOpen: true,
    icon: FaBriefcase,
  },
];

// ---------------------------------------------------------
// FORM DEFAULTS
// ---------------------------------------------------------

const EMPTY_COURSE_FORM = {
  title: "",
  category: "",
  description: "",
  fullDescription: "",
  duration: "",
  eligibility: "",
  prerequisites: "",
  fee: "",
  format: "In-person",
  curriculum: "",
  certificate: true,
  enrollmentOpen: true,
  isPublished: true,
};

const EMPTY_STUDENT = {
  fullName: "",
  email: "",
  phone: "",
};

// ---------------------------------------------------------
// HELPERS
// ---------------------------------------------------------

const formatNaira = (amount) => {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 0,
  }).format(Number(amount) || 0);
};

const normaliseCourse = (course) => ({
  ...course,
  fee: Number(course.fee) || 0,
  curriculum: Array.isArray(course.curriculum)
    ? course.curriculum
    : typeof course.curriculum === "string"
      ? course.curriculum
          .split(/\r?\n/)
          .map((item) => item.trim())
          .filter(Boolean)
      : [],
});

const getCourseFormValues = (course) => ({
  title: course.title || "",
  category: course.category || "",
  description: course.description || "",
  fullDescription:
    course.fullDescription || course.description || "",
  duration: course.duration || "",
  eligibility: course.eligibility || "",
  prerequisites: course.prerequisites || "",
  fee: String(course.fee ?? ""),
  format: course.format || "In-person",
  curriculum: Array.isArray(course.curriculum)
    ? course.curriculum.join("\n")
    : course.curriculum || "",
  certificate: course.certificate !== false,
  enrollmentOpen: course.enrollmentOpen !== false,
  isPublished: course.isPublished !== false,
})

// ---------------------------------------------------------
// ACADEMY COMPONENT
// ---------------------------------------------------------

const Academy = () => {
  const context = useMyContext() || {};
  const currentUser = context.currentUser;
  const isAdmin =
    Boolean(context.isAdmin) ||
    currentUser?.role === "admin";

  // Courses created by the administrator.
  const [databaseCourses, setDatabaseCourses] = useState([]);
  const [loadingCourses, setLoadingCourses] = useState(true);
  const [courseLoadError, setCourseLoadError] = useState("");

  // Course manager.
  const [showCourseForm, setShowCourseForm] = useState(false);
  const [editingCourse, setEditingCourse] = useState(null);
  const [courseForm, setCourseForm] = useState(EMPTY_COURSE_FORM);
  const [savingCourse, setSavingCourse] = useState(false);
  const [courseFormError, setCourseFormError] = useState("");

  // Course details and student checkout.
  const [activeCourse, setActiveCourse] = useState(null);
  const [modalView, setModalView] = useState("");
  const [student, setStudent] = useState(EMPTY_STUDENT);
  const [studentFormError, setStudentFormError] = useState("");
  const [checkoutNotice, setCheckoutNotice] = useState("");
  const [enrollmentReference, setEnrollmentReference] = useState("");

  // -------------------------------------------------------
  // LIVE COURSE LISTENER
  // -------------------------------------------------------

  useEffect(() => {
    const unsubscribe = onSnapshot(
      COURSES_COLLECTION,
      (snapshot) => {
        const courses = snapshot.docs.map((courseDoc) => ({
          id: courseDoc.id,
          ...courseDoc.data(),
          isDefault: false,
        }));

        courses.sort((a, b) => {
          const aTime = a.createdAt?.toMillis?.() || 0;
          const bTime = b.createdAt?.toMillis?.() || 0;
          return bTime - aTime;
        });

        setDatabaseCourses(courses);
        setCourseLoadError("");
        setLoadingCourses(false);
      },
      (error) => {
        console.error("Folange Academy course loading error:", error);
        setCourseLoadError(
          "We could not load additional courses from the database. Starter courses remain available."
        );
        setLoadingCourses(false);
      }
    );

    return () => unsubscribe();
  }, []);

  // -------------------------------------------------------
  // COURSE CATALOGUE
  // -------------------------------------------------------

  const courses = useMemo(() => {
    const additionalCourses = databaseCourses
      .filter((course) => {
        // Administrators can also see unpublished courses.
        return isAdmin || course.isPublished !== false;
      })
      .map(normaliseCourse);

    return [
      ...DEFAULT_COURSES.map(normaliseCourse),
      ...additionalCourses,
    ];
  }, [databaseCourses, isAdmin]);

  // -------------------------------------------------------
  // NAVIGATION AND ENQUIRIES
  // -------------------------------------------------------

  const scrollToCourses = () => {
    document.getElementById("academy-courses")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  const handleEnquiry = (courseTitle = "") => {
    if (courseTitle) {
      try {
        sessionStorage.setItem(
          "folangeAcademyEnquiry",
          courseTitle
        );
      } catch (error) {
        console.warn("Could not save academy enquiry:", error);
      }
    }

    document.getElementById("contact")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });

    if (!document.getElementById("contact")) {
      window.location.hash = "contact";
    }
  };

  // -------------------------------------------------------
  // COURSE DETAILS
  // -------------------------------------------------------

  const openCourse = (course) => {
    setActiveCourse(course);
    setModalView("details");
    setStudent(EMPTY_STUDENT);
    setStudentFormError("");
    setCheckoutNotice("");
    setEnrollmentReference("");
  };

  const closeCourseModal = () => {
    setActiveCourse(null);
    setModalView("");
    setStudent(EMPTY_STUDENT);
    setStudentFormError("");
    setCheckoutNotice("");
    setEnrollmentReference("");
  };

  const startCheckout = () => {
    if (!activeCourse) return;

    if (
      activeCourse.enrollmentOpen === false ||
      activeCourse.isPublished === false
    ) {
      return;
    }

    setStudentFormError("");
    setCheckoutNotice("");
    setModalView("student");
  };

  // -------------------------------------------------------
  // ADMIN: OPEN COURSE FORM
  // -------------------------------------------------------

  const openAddCourseForm = () => {
    setEditingCourse(null);
    setCourseForm(EMPTY_COURSE_FORM);
    setCourseFormError("");
    setShowCourseForm(true);
  };

  const openEditCourseForm = (course) => {
    if (!isAdmin || course.isDefault) return;

    setEditingCourse(course);
    setCourseForm(getCourseFormValues(course));
    setCourseFormError("");
    setShowCourseForm(true);
  };

  const closeCourseForm = () => {
    if (savingCourse) return;

    setShowCourseForm(false);
    setEditingCourse(null);
    setCourseForm(EMPTY_COURSE_FORM);
    setCourseFormError("");
  };

  const updateCourseFormField = (event) => {
    const { name, value, type, checked } = event.target;

    setCourseForm((previous) => ({
      ...previous,
      [name]: type === "checkbox" ? checked : value,
    }));
  };

  // -------------------------------------------------------
  // ADMIN: SAVE COURSE TO FIRESTORE
  // -------------------------------------------------------

  const handleSaveCourse = async (event) => {
    event.preventDefault();

    if (!isAdmin) {
      setCourseFormError(
        "Only an administrator can add or edit courses."
      );
      return;
    }

    const fee = Number(courseForm.fee);

    if (!courseForm.title.trim()) {
      setCourseFormError("Please enter the course title.");
      return;
    }

    if (!courseForm.category.trim()) {
      setCourseFormError("Please enter the course category.");
      return;
    }

    if (!courseForm.description.trim()) {
      setCourseFormError("Please enter a short description.");
      return;
    }

    if (!courseForm.duration.trim()) {
      setCourseFormError("Please enter the course duration.");
      return;
    }

    if (!courseForm.eligibility.trim()) {
      setCourseFormError("Please enter the eligibility requirements.");
      return;
    }

    if (!Number.isFinite(fee) || fee < 0) {
      setCourseFormError(
        "Please enter a valid course fee. Use 0 for a free course."
      );
      return;
    }

    const curriculum = courseForm.curriculum
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean);

    const courseData = {
      title: courseForm.title.trim(),
      category: courseForm.category.trim().toUpperCase(),
      description: courseForm.description.trim(),
      fullDescription:
        courseForm.fullDescription.trim() ||
        courseForm.description.trim(),
      duration: courseForm.duration.trim(),
      eligibility: courseForm.eligibility.trim(),
      prerequisites: courseForm.prerequisites.trim(),
      fee,
      format: courseForm.format,
      curriculum,
      certificate: Boolean(courseForm.certificate),
      enrollmentOpen: Boolean(courseForm.enrollmentOpen),
      isPublished: Boolean(courseForm.isPublished),
      updatedAt: serverTimestamp(),
    };

    setSavingCourse(true);
    setCourseFormError("");

    try {
      if (editingCourse?.id && !editingCourse.isDefault) {
        const courseRef = doc(
          db,
          ...folangeCollectionPath("courses"),
          editingCourse.id
        );

        await updateDoc(courseRef, courseData);
      } else {
        await addDoc(COURSES_COLLECTION, {
          ...courseData,
          createdAt: serverTimestamp(),
          createdBy: currentUser?.uid || null,
        });
      }

      setShowCourseForm(false);
      setEditingCourse(null);
      setCourseForm(EMPTY_COURSE_FORM);
      setCourseFormError("");
    } catch (error) {
      console.error("Folange course save error:", error);

      if (
        error?.code === "permission-denied" ||
        String(error?.message || "")
          .toLowerCase()
          .includes("insufficient permissions")
      ) {
        setCourseFormError(
          "Firestore denied this action. Check that your account is an administrator and that the courses collection rules permit administrator writes."
        );
      } else {
        setCourseFormError(
          error?.message ||
            "The course could not be saved. Please try again."
        );
      }
    } finally {
      setSavingCourse(false);
    }
  };

  // -------------------------------------------------------
  // ADMIN: DELETE COURSE
  // -------------------------------------------------------

  const handleDeleteCourse = async (course) => {
    if (!isAdmin || course.isDefault) return;

    const confirmed = window.confirm(
      `Delete "${course.title}" from the course catalogue? This cannot be undone.`
    );

    if (!confirmed) return;

    try {
      await deleteDoc(
        doc(
          db,
          ...folangeCollectionPath("courses"),
          course.id
        )
      );
    } catch (error) {
      console.error("Folange course delete error:", error);
      window.alert(
        "The course could not be deleted. Please check your administrator permissions and Firestore rules."
      );
    }
  };

  // -------------------------------------------------------
  // STUDENT: ENROLMENT DETAILS
  // -------------------------------------------------------

  const updateStudentField = (event) => {
    const { name, value } = event.target;

    setStudent((previous) => ({
      ...previous,
      [name]: value,
    }));
  };

  const handleStudentDetailsSubmit = (event) => {
    event.preventDefault();

    if (!activeCourse) {
      setStudentFormError("Please select a course.");
      return;
    }

    if (!student.fullName.trim()) {
      setStudentFormError("Please enter your full name.");
      return;
    }

    if (!student.email.trim()) {
      setStudentFormError("Please enter your email address.");
      return;
    }

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailPattern.test(student.email.trim())) {
      setStudentFormError("Please enter a valid email address.");
      return;
    }

    if (!student.phone.trim()) {
      setStudentFormError("Please enter your phone number.");
      return;
    }

    setStudentFormError("");
    setCheckoutNotice("");
    setModalView("payment");
  };

  // -------------------------------------------------------
  // DEMO CHECKOUT
  //
  // This does not contact a payment gateway and does not charge
  // money. It stores a demo record in this browser only.
  // Replace this function with verified gateway checkout later.
  // -------------------------------------------------------

  const handleDemoPayment = () => {
    if (!activeCourse) return;

    const reference = `FOL-DEMO-${Date.now()}`;

    const demoEnrolment = {
      reference,
      courseId: activeCourse.id,
      courseTitle: activeCourse.title,
      courseFee: Number(activeCourse.fee) || 0,
      studentName: student.fullName.trim(),
      studentEmail: student.email.trim(),
      studentPhone: student.phone.trim(),
      paymentProvider: "DEMO_ONLY",
      paymentStatus: "DEMO_SUCCESS",
      enrollmentStatus: "DEMO_CONFIRMED",
      createdAt: new Date().toISOString(),
      disclaimer:
        "This is a demonstration only. No real payment was made.",
    };

    try {
      const saved = JSON.parse(
        localStorage.getItem(DEMO_ENROLMENTS_KEY) || "[]"
      );

      const previousEnrolments = Array.isArray(saved) ? saved : [];

      localStorage.setItem(
        DEMO_ENROLMENTS_KEY,
        JSON.stringify([
          demoEnrolment,
          ...previousEnrolments,
        ])
      );

      setCheckoutNotice("");
    } catch (error) {
      console.warn(
        "Demo enrolment could not be saved in local storage:",
        error
      );

      setCheckoutNotice(
        "The demo confirmation is visible, but this browser could not save a local demo record."
      );
    }

    setEnrollmentReference(reference);
    setModalView("success");
  };

  // -------------------------------------------------------
  // SHARED STYLING
  // -------------------------------------------------------

  const fieldClass =
    "w-full rounded-xl border border-[#E7D8B8] bg-white px-4 py-3 text-sm text-[#3F3528] outline-none transition focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/20";

  const labelClass =
    "mb-2 block text-sm font-semibold text-[#6D501C]";

  // -------------------------------------------------------
  // RENDER
  // -------------------------------------------------------

  return (
    <section
      id="academy"
      aria-labelledby="folange-academy-heading"
      className="relative overflow-hidden bg-[#FFFCF7] py-16 text-[#3F3528] sm:py-20 lg:py-24"
    >
      {/* Decorative background elements */}

      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-[#E8D6A8] opacity-20 blur-3xl"
      />

      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-24 -left-24 h-72 w-72 rounded-full bg-[#D4AF37] opacity-10 blur-3xl"
      />

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Demo checkout notice */}

        <div className="mb-8 flex items-start gap-3 rounded-2xl border border-[#E7D8B8] bg-white p-4 text-sm text-[#766A58]">
          <FaInfoCircle className="mt-1 shrink-0 text-[#9A7428]" />

          <p className="leading-6">
            <strong className="text-[#6D501C]">
              Academy preview:
            </strong>{" "}
            course fees are sample values and checkout is currently a
            demonstration. No real payment will be processed.
          </p>
        </div>

        {/* Academy introduction */}

        <div className="mx-auto mb-14 max-w-3xl text-center">
          <span className="mb-4 inline-flex items-center gap-2 rounded-full border border-[#E7D8B8] bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#8A6517]">
            <FaGraduationCap />
            Learn with Folange
          </span>

          <h2
            id="folange-academy-heading"
            className="mb-5 text-4xl font-normal leading-tight text-[#6D501C] sm:text-5xl lg:text-6xl"
            style={{
              fontFamily: "Georgia, 'Times New Roman', serif",
            }}
          >
            Folange Beauty Academy
          </h2>

          <div className="mx-auto mb-6 h-1 w-20 rounded-full bg-[#D4AF37]" />

          <p className="text-base leading-8 text-[#766A58] sm:text-lg">
            Discover your potential in the beauty industry. Explore
            learning opportunities designed to help you develop your
            skills, build your confidence, and take your next step in
            beauty and wellness.
          </p>

          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <button
              type="button"
              onClick={scrollToCourses}
              className="inline-flex items-center justify-center gap-3 rounded-full bg-[#D4AF37] px-7 py-3.5 font-semibold text-[#3F3528] shadow-md transition duration-300 hover:bg-[#E7C65C] hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-[#8A6517] focus:ring-offset-2"
            >
              Explore Courses
              <FaArrowRight />
            </button>

            {isAdmin && (
              <button
                type="button"
                onClick={openAddCourseForm}
                className="inline-flex items-center justify-center gap-2 rounded-full border border-[#D4AF37] bg-white px-6 py-3.5 font-semibold text-[#8A6517] transition hover:bg-[#F8F0DF]"
              >
                <FaPlus />
                Add Course
              </button>
            )}
          </div>
        </div>

        {/* Academy benefits */}

        <div className="mb-16 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {[
            {
              title: "Practical Skills",
              description:
                "Build your understanding of beauty techniques and professional practices.",
            },
            {
              title: "Personal Growth",
              description:
                "Develop confidence and explore opportunities in the beauty industry.",
            },
            {
              title: "Business Knowledge",
              description:
                "Discover ways to approach clients, present your services, and grow your brand.",
            },
          ].map((benefit) => (
            <div
              key={benefit.title}
              className="flex items-start gap-4 rounded-2xl border border-[#EADFCB] bg-white/90 p-5 shadow-sm transition duration-300 hover:-translate-y-1 hover:shadow-md sm:p-6"
            >
              <span className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#F5EBD5] text-[#8A6517]">
                <FaCheckCircle />
              </span>

              <div>
                <h3 className="mb-2 font-semibold text-[#6D501C]">
                  {benefit.title}
                </h3>

                <p className="text-sm leading-6 text-[#766A58]">
                  {benefit.description}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* Course catalogue */}

        <div
          id="academy-courses"
          className="mb-10 scroll-mt-24 text-center"
        >
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.25em] text-[#8A6517]">
            Find Your Interest
          </p>

          <h3
            className="text-3xl text-[#6D501C] sm:text-4xl"
            style={{
              fontFamily: "Georgia, 'Times New Roman', serif",
            }}
          >
            Explore Our Courses
          </h3>

          <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-[#766A58] sm:text-base">
            Review course content, duration, eligibility, and fees.
            Select a course to see the full details and proceed to
            enrolment.
          </p>

          {isAdmin && (
            <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-[#E7D8B8] bg-white px-4 py-2 text-xs text-[#8A6517]">
              <FaLock />
              Administrator course management enabled
            </div>
          )}
        </div>

        {courseLoadError && (
          <div
            role="status"
            className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-800"
          >
            <FaExclamationTriangle className="mr-2 inline" />
            {courseLoadError}
          </div>
        )}

        {loadingCourses && (
          <p className="mb-6 text-center text-sm text-[#766A58]">
            Checking for additional courses...
          </p>
        )}

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {courses.map((course) => {
            const CourseIcon = course.icon || FaGraduationCap;

            const canEnroll =
              course.enrollmentOpen !== false &&
              course.isPublished !== false;

            return (
              <article
                key={course.id}
                className="group flex h-full flex-col overflow-hidden rounded-2xl border border-[#E7D8B8] bg-white shadow-sm transition duration-300 hover:-translate-y-1 hover:border-[#D4AF37] hover:shadow-xl"
              >
                <div className="relative flex min-h-44 items-center justify-center bg-gradient-to-br from-[#F8F0DF] via-[#F5E7C6] to-[#E9D5A5] p-8">
                  <div className="flex h-24 w-24 items-center justify-center rounded-full border border-[#D4AF37]/50 bg-white/70 text-[#8A6517] shadow-sm transition duration-300 group-hover:scale-110">
                    <CourseIcon
                      className="text-4xl"
                      aria-hidden="true"
                    />
                  </div>

                  {course.isPublished === false && isAdmin && (
                    <span className="absolute right-3 top-3 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
                      Unpublished
                    </span>
                  )}

                  {course.isDefault && (
                    <span className="absolute left-3 top-3 rounded-full bg-white/80 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-[#8A6517]">
                      Starter course
                    </span>
                  )}
                </div>

                <div className="flex flex-1 flex-col p-6">
                  <p className="mb-3 text-[10px] font-bold tracking-[0.18em] text-[#9A7428]">
                    {course.category}
                  </p>

                  <h4
                    className="mb-3 text-2xl leading-snug text-[#6D501C]"
                    style={{
                      fontFamily: "Georgia, 'Times New Roman', serif",
                    }}
                  >
                    {course.title}
                  </h4>

                  <p className="mb-5 flex-1 text-sm leading-7 text-[#766A58]">
                    {course.description}
                  </p>

                  <div className="mb-5 space-y-3 border-t border-[#EEE2C9] pt-4">
                    <div className="flex items-start gap-2 text-sm text-[#766A58]">
                      <FaClock className="mt-1 shrink-0 text-[#9A7428]" />
                      <span>
                        <strong className="text-[#6D501C]">
                          Duration:
                        </strong>{" "}
                        {course.duration}
                      </span>
                    </div>

                    <div className="flex items-start gap-2 text-sm text-[#766A58]">
                      <FaUserGraduate className="mt-1 shrink-0 text-[#9A7428]" />
                      <span>
                        <strong className="text-[#6D501C]">
                          Eligibility:
                        </strong>{" "}
                        {course.eligibility}
                      </span>
                    </div>

                    <div className="flex items-start gap-2 text-sm text-[#766A58]">
                      <FaMoneyBillWave className="mt-1 shrink-0 text-[#9A7428]" />
                      <span>
                        <strong className="text-[#6D501C]">
                          Course fee:
                        </strong>{" "}
                        {formatNaira(course.fee)}
                      </span>
                    </div>
                  </div>

                  {!canEnroll && (
                    <p className="mb-4 rounded-lg bg-[#F8F0DF] px-3 py-2 text-xs font-semibold text-[#8A6517]">
                      {course.isPublished === false
                        ? "This course is not published."
                        : "Enrolment is currently closed."}
                    </p>
                  )}

                  <button
                    type="button"
                    onClick={() => openCourse(course)}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-[#D4AF37] px-4 py-3 text-sm font-semibold text-[#8A6517] transition duration-300 hover:bg-[#D4AF37] hover:text-[#3F3528] focus:outline-none focus:ring-2 focus:ring-[#8A6517] focus:ring-offset-2"
                  >
                    View Course Details
                    <FaArrowRight className="transition-transform group-hover:translate-x-1" />
                  </button>

                  {isAdmin && !course.isDefault && (
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => openEditCourseForm(course)}
                        className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#E7D8B8] px-3 py-2 text-xs font-semibold text-[#6D501C] transition hover:bg-[#F8F0DF]"
                      >
                        <FaEdit />
                        Edit
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDeleteCourse(course)}
                        className="inline-flex items-center justify-center gap-2 rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-50"
                      >
                        <FaTrash />
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>

        {/* Closing call to action */}

        <div className="mt-16 overflow-hidden rounded-3xl bg-[#5A4526] px-6 py-10 text-center text-[#FFFCF7] shadow-lg sm:px-10 sm:py-14">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.25em] text-[#E8CD83]">
            Your Beauty Journey Starts Here
          </p>

          <h3
            className="mx-auto max-w-2xl text-3xl leading-tight sm:text-4xl"
            style={{
              fontFamily: "Georgia, 'Times New Roman', serif",
            }}
          >
            Ready to Learn, Create and Grow?
          </h3>

          <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-[#F1E7D5] sm:text-base">
            Choose a course that matches your interests, review the
            requirements, and take your next step with Folange Beauty
            Academy.
          </p>

          <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <button
              type="button"
              onClick={scrollToCourses}
              className="inline-flex items-center justify-center gap-3 rounded-full bg-[#D4AF37] px-7 py-3.5 font-semibold text-[#3F3528] transition duration-300 hover:bg-[#E7C65C] focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-[#5A4526]"
            >
              Browse Courses
              <FaArrowRight />
            </button>

            <button
              type="button"
              onClick={() => handleEnquiry()}
              className="inline-flex items-center justify-center gap-3 rounded-full border border-[#E8CD83] px-7 py-3.5 font-semibold text-white transition duration-300 hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white"
            >
              Contact Us
            </button>
          </div>
        </div>
      </div>

      {/* =====================================================
          COURSE DETAILS AND STUDENT CHECKOUT MODAL
      ====================================================== */}

      {activeCourse && modalView && (
        <div
          className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 p-3 backdrop-blur-sm sm:p-6"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeCourseModal();
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="academy-modal-title"
            className="relative max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-3xl bg-[#FFFCF7] shadow-2xl"
          >
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[#EADFCB] bg-[#FFFCF7]/95 px-5 py-4 backdrop-blur sm:px-7">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#9A7428]">
                  Folange Beauty Academy
                </p>

                <h3
                  id="academy-modal-title"
                  className="mt-1 text-xl text-[#6D501C] sm:text-2xl"
                  style={{
                    fontFamily: "Georgia, 'Times New Roman', serif",
                  }}
                >
                  {modalView === "details" && "Course Details"}
                  {modalView === "student" && "Student Enrolment"}
                  {modalView === "payment" && "Demo Checkout"}
                  {modalView === "success" && "Demo Confirmation"}
                </h3>
              </div>

              <button
                type="button"
                onClick={closeCourseModal}
                aria-label="Close course window"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#E7D8B8] text-[#6D501C] transition hover:bg-[#F5EBD5]"
              >
                <FaTimes />
              </button>
            </div>

            <div className="p-5 sm:p-7">
              {/* COURSE DETAILS */}

              {modalView === "details" && (
                <div>
                  <div className="mb-6 rounded-2xl bg-gradient-to-br from-[#F8F0DF] to-[#E9D5A5] p-6 sm:p-8">
                    <p className="mb-2 text-xs font-bold uppercase tracking-[0.2em] text-[#8A6517]">
                      {activeCourse.category}
                    </p>

                    <h4
                      className="text-3xl text-[#6D501C] sm:text-4xl"
                      style={{
                        fontFamily:
                          "Georgia, 'Times New Roman', serif",
                      }}
                    >
                      {activeCourse.title}
                    </h4>

                    <p className="mt-4 text-sm leading-7 text-[#6D5A3B]">
                      {activeCourse.fullDescription ||
                        activeCourse.description}
                    </p>

                    <div className="mt-6 flex flex-wrap items-center gap-3">
                      <span className="inline-flex items-center gap-2 rounded-full bg-white/80 px-4 py-2 text-sm font-semibold text-[#6D501C]">
                        <FaMoneyBillWave className="text-[#9A7428]" />
                        {formatNaira(activeCourse.fee)}
                      </span>

                      <span className="inline-flex items-center gap-2 rounded-full bg-white/80 px-4 py-2 text-sm text-[#6D501C]">
                        <FaClock className="text-[#9A7428]" />
                        {activeCourse.duration}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                    <div className="rounded-2xl border border-[#EADFCB] bg-white p-5">
                      <h5 className="mb-3 flex items-center gap-2 font-semibold text-[#6D501C]">
                        <FaUserGraduate className="text-[#9A7428]" />
                        Eligibility
                      </h5>

                      <p className="text-sm leading-7 text-[#766A58]">
                        {activeCourse.eligibility ||
                          "Contact Folange for eligibility information."}
                      </p>
                    </div>

                    <div className="rounded-2xl border border-[#EADFCB] bg-white p-5">
                      <h5 className="mb-3 flex items-center gap-2 font-semibold text-[#6D501C]">
                        <FaInfoCircle className="text-[#9A7428]" />
                        Prerequisites
                      </h5>

                      <p className="text-sm leading-7 text-[#766A58]">
                        {activeCourse.prerequisites ||
                          "No additional prerequisites have been specified."}
                      </p>
                    </div>

                    <div className="rounded-2xl border border-[#EADFCB] bg-white p-5">
                      <h5 className="mb-3 flex items-center gap-2 font-semibold text-[#6D501C]">
                        <FaMapMarkerAlt className="text-[#9A7428]" />
                        Training Format
                      </h5>

                      <p className="text-sm leading-7 text-[#766A58]">
                        {activeCourse.format || "Contact for details"}
                      </p>
                    </div>

                    <div className="rounded-2xl border border-[#EADFCB] bg-white p-5">
                      <h5 className="mb-3 flex items-center gap-2 font-semibold text-[#6D501C]">
                        <FaCertificate className="text-[#9A7428]" />
                        Certificate
                      </h5>

                      <p className="text-sm leading-7 text-[#766A58]">
                        {activeCourse.certificate
                          ? "A certificate is indicated for this course. Contact Folange to confirm the completion requirements."
                          : "A certificate has not been specified for this course."}
                      </p>
                    </div>
                  </div>

                  <div className="mt-6 rounded-2xl border border-[#EADFCB] bg-white p-5 sm:p-6">
                    <h5 className="mb-4 flex items-center gap-2 font-semibold text-[#6D501C]">
                      <FaListUl className="text-[#9A7428]" />
                      Course Curriculum
                    </h5>

                    {Array.isArray(activeCourse.curriculum) &&
                    activeCourse.curriculum.length > 0 ? (
                      <ul className="space-y-3">
                        {activeCourse.curriculum.map((topic, index) => (
                          <li
                            key={`${activeCourse.id}-topic-${index}`}
                            className="flex items-start gap-3 text-sm leading-6 text-[#766A58]"
                          >
                            <FaCheckCircle className="mt-1 shrink-0 text-[#B18A2B]" />
                            <span>{topic}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm leading-7 text-[#766A58]">
                        Detailed curriculum will be provided by Folange.
                      </p>
                    )}
                  </div>

                  <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                    <button
                      type="button"
                      onClick={() =>
                        handleEnquiry(activeCourse.title)
                      }
                      className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-[#D4AF37] px-5 py-3.5 text-sm font-semibold text-[#8A6517] transition hover:bg-[#F5EBD5]"
                    >
                      Ask About This Course
                    </button>

                    <button
                      type="button"
                      disabled={
                        activeCourse.enrollmentOpen === false ||
                        activeCourse.isPublished === false
                      }
                      onClick={startCheckout}
                      className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#D4AF37] px-5 py-3.5 text-sm font-semibold text-[#3F3528] transition hover:bg-[#E7C65C] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {activeCourse.enrollmentOpen === false ||
                      activeCourse.isPublished === false
                        ? "Enrolment Unavailable"
                        : "Enrol in This Course"}
                      <FaArrowRight />
                    </button>
                  </div>
                </div>
              )}

              {/* STUDENT DETAILS */}

              {modalView === "student" && (
                <form
                  onSubmit={handleStudentDetailsSubmit}
                  className="space-y-6"
                >
                  <button
                    type="button"
                    onClick={() => setModalView("details")}
                    className="inline-flex items-center gap-2 text-sm font-semibold text-[#8A6517] hover:text-[#6D501C]"
                  >
                    <FaArrowLeft />
                    Back to course details
                  </button>

                  <div className="rounded-2xl border border-[#EADFCB] bg-white p-5">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#9A7428]">
                      Selected Course
                    </p>

                    <h4 className="mt-2 text-xl font-semibold text-[#6D501C]">
                      {activeCourse.title}
                    </h4>

                    <p className="mt-2 text-sm text-[#766A58]">
                      Duration: {activeCourse.duration}
                    </p>

                    <p className="mt-3 text-2xl font-semibold text-[#8A6517]">
                      {Number(activeCourse.fee) > 0
                        ? formatNaira(activeCourse.fee)
                        : "Free"}
                    </p>
                  </div>

                  <div>
                    <h4
                      className="mb-2 text-2xl text-[#6D501C]"
                      style={{
                        fontFamily:
                          "Georgia, 'Times New Roman', serif",
                      }}
                    >
                      Your Details
                    </h4>

                    <p className="text-sm leading-6 text-[#766A58]">
                      Enter your details to continue to the demonstration
                      checkout.
                    </p>
                  </div>

                  <div>
                    <label
                      htmlFor="academy-student-name"
                      className={labelClass}
                    >
                      Full Name
                    </label>

                    <input
                      id="academy-student-name"
                      name="fullName"
                      type="text"
                      autoComplete="name"
                      required
                      value={student.fullName}
                      onChange={updateStudentField}
                      placeholder="Enter your full name"
                      className={fieldClass}
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="academy-student-email"
                      className={labelClass}
                    >
                      Email Address
                    </label>

                    <input
                      id="academy-student-email"
                      name="email"
                      type="email"
                      autoComplete="email"
                      required
                      value={student.email}
                      onChange={updateStudentField}
                      placeholder="you@example.com"
                      className={fieldClass}
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="academy-student-phone"
                      className={labelClass}
                    >
                      Phone Number
                    </label>

                    <input
                      id="academy-student-phone"
                      name="phone"
                      type="tel"
                      autoComplete="tel"
                      required
                      value={student.phone}
                      onChange={updateStudentField}
                      placeholder="Enter your phone number"
                      className={fieldClass}
                    />
                  </div>

                  {studentFormError && (
                    <p
                      role="alert"
                      className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm leading-6 text-red-700"
                    >
                      {studentFormError}
                    </p>
                  )}

                  <button
                    type="submit"
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#D4AF37] px-5 py-3.5 font-semibold text-[#3F3528] transition hover:bg-[#E7C65C]"
                  >
                    Continue to Checkout
                    <FaArrowRight />
                  </button>

                  <p className="text-xs leading-5 text-[#8B8071]">
                    This is a checkout demonstration. Do not use it as
                    proof of payment or confirmed enrolment.
                  </p>
                </form>
              )}

              {/* DEMO PAYMENT */}

              {modalView === "payment" && (
                <div className="space-y-6">
                  <button
                    type="button"
                    onClick={() => setModalView("student")}
                    className="inline-flex items-center gap-2 text-sm font-semibold text-[#8A6517] hover:text-[#6D501C]"
                  >
                    <FaArrowLeft />
                    Back to student details
                  </button>

                  <div className="rounded-2xl border border-[#EADFCB] bg-white p-5 sm:p-6">
                    <div className="mb-5 flex items-center gap-3">
                      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#F5EBD5] text-[#8A6517]">
                        <FaCreditCard className="text-xl" />
                      </span>

                      <div>
                        <h4 className="text-xl font-semibold text-[#6D501C]">
                          Checkout Summary
                        </h4>

                        <p className="text-sm text-[#766A58]">
                          Review your details before continuing.
                        </p>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="flex items-start justify-between gap-4 border-b border-[#EEE2C9] pb-4">
                        <span className="text-sm text-[#766A58]">
                          Course
                        </span>

                        <span className="text-right text-sm font-semibold text-[#6D501C]">
                          {activeCourse.title}
                        </span>
                      </div>

                      <div className="flex items-start justify-between gap-4 border-b border-[#EEE2C9] pb-4">
                        <span className="text-sm text-[#766A58]">
                          Student
                        </span>

                        <span className="text-right text-sm font-semibold text-[#6D501C]">
                          {student.fullName}
                        </span>
                      </div>

                      <div className="flex items-start justify-between gap-4 border-b border-[#EEE2C9] pb-4">
                        <span className="text-sm text-[#766A58]">
                          Email
                        </span>

                        <span className="max-w-[60%] break-words text-right text-sm text-[#6D501C]">
                          {student.email}
                        </span>
                      </div>

                      <div className="flex items-start justify-between gap-4 border-b border-[#EEE2C9] pb-4">
                        <span className="text-sm text-[#766A58]">
                          Duration
                        </span>

                        <span className="text-right text-sm text-[#6D501C]">
                          {activeCourse.duration}
                        </span>
                      </div>

                      <div className="flex items-center justify-between gap-4 pt-1">
                        <span className="font-semibold text-[#6D501C]">
                          Total
                        </span>

                        <span className="text-2xl font-semibold text-[#8A6517]">
                          {Number(activeCourse.fee) > 0
                            ? formatNaira(activeCourse.fee)
                            : "Free"}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4">
                    <p className="flex items-start gap-3 text-sm leading-6 text-amber-900">
                      <FaInfoCircle className="mt-1 shrink-0" />

                      <span>
                        <strong>Demo payment only.</strong> No payment
                        gateway is connected. The button below simulates
                        a checkout confirmation and does not charge your
                        account or transfer money to Folange.
                      </span>
                    </p>
                  </div>

                  {checkoutNotice && (
                    <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-800">
                      {checkoutNotice}
                    </p>
                  )}

                  <button
                    type="button"
                    onClick={handleDemoPayment}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#D4AF37] px-5 py-3.5 font-semibold text-[#3F3528] transition hover:bg-[#E7C65C]"
                  >
                    <FaCreditCard />
                    {Number(activeCourse.fee) > 0
                      ? "Simulate Demo Payment"
                      : "Confirm Free Demo Enrolment"}
                  </button>

                  <p className="text-center text-xs leading-5 text-[#8B8071]">
                    A demo reference will be generated for testing.
                    It is not a payment receipt.
                  </p>
                </div>
              )}

              {/* DEMO CONFIRMATION */}

              {modalView === "success" && (
                <div className="py-5 text-center sm:py-8">
                  <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-[#F5EBD5] text-[#8A6517]">
                    <FaCheckCircle className="text-4xl" />
                  </div>

                  <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-[#9A7428]">
                    Demonstration Complete
                  </p>

                  <h4
                    className="text-3xl text-[#6D501C] sm:text-4xl"
                    style={{
                      fontFamily:
                        "Georgia, 'Times New Roman', serif",
                    }}
                  >
                    Thank You, {student.fullName.split(" ")[0]}!
                  </h4>

                  <p className="mx-auto mt-4 max-w-lg text-sm leading-7 text-[#766A58]">
                    The demo checkout for{" "}
                    <strong>{activeCourse.title}</strong> has been
                    completed on this browser. This is not proof of
                    real payment, and the enrolment has not been
                    verified by a payment provider.
                  </p>

                  {enrollmentReference && (
                    <div className="mx-auto mt-6 max-w-md rounded-2xl border border-[#EADFCB] bg-white p-5">
                      <p className="text-xs font-semibold uppercase tracking-[0.15em] text-[#9A7428]">
                        Demo Reference
                      </p>

                      <p className="mt-2 break-all text-lg font-semibold text-[#6D501C]">
                        {enrollmentReference}
                      </p>

                      <p className="mt-3 text-sm text-[#766A58]">
                        Course: {activeCourse.title}
                      </p>

                      <p className="mt-1 text-sm text-[#766A58]">
                        Amount shown:{" "}
                        {formatNaira(activeCourse.fee)}
                      </p>

                      <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
                        DEMO ONLY — no money was charged.
                      </p>
                    </div>
                  )}

                  {checkoutNotice && (
                    <p className="mx-auto mt-4 max-w-md rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-800">
                      {checkoutNotice}
                    </p>
                  )}

                  <button
                    type="button"
                    onClick={closeCourseModal}
                    className="mt-7 inline-flex items-center justify-center gap-2 rounded-full bg-[#D4AF37] px-7 py-3.5 font-semibold text-[#3F3528] transition hover:bg-[#E7C65C]"
                  >
                    Return to Academy
                    <FaArrowRight />
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* =====================================================
          ADMIN: ADD OR EDIT COURSE MODAL
      ====================================================== */}

      {isAdmin && showCourseForm && (
        <div
          className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/60 p-3 backdrop-blur-sm sm:p-6"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeCourseForm();
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="academy-course-form-title"
            className="max-h-[94vh] w-full max-w-3xl overflow-y-auto rounded-3xl bg-[#FFFCF7] shadow-2xl"
          >
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[#EADFCB] bg-[#FFFCF7]/95 px-5 py-4 backdrop-blur sm:px-7">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#9A7428]">
                  Administrator
                </p>

                <h3
                  id="academy-course-form-title"
                  className="mt-1 text-2xl text-[#6D501C]"
                  style={{
                    fontFamily: "Georgia, 'Times New Roman', serif",
                  }}
                >
                  {editingCourse ? "Edit Course" : "Add New Course"}
                </h3>
              </div>

              <button
                type="button"
                onClick={closeCourseForm}
                disabled={savingCourse}
                aria-label="Close course form"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#E7D8B8] text-[#6D501C] transition hover:bg-[#F5EBD5] disabled:opacity-50"
              >
                <FaTimes />
              </button>
            </div>

            <form
              onSubmit={handleSaveCourse}
              className="space-y-5 p-5 sm:p-7"
            >
              <div className="rounded-xl border border-[#E7D8B8] bg-white p-4 text-sm leading-6 text-[#766A58]">
                Courses created here are stored in the Folange Firestore
                collection <strong>folange/main/courses</strong>.
                Publishing a course makes it visible to students.
              </div>

              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="academy-course-title"
                    className={labelClass}
                  >
                    Course Title *
                  </label>

                  <input
                    id="academy-course-title"
                    name="title"
                    type="text"
                    required
                    value={courseForm.title}
                    onChange={updateCourseFormField}
                    placeholder="e.g. Professional Nail Technology"
                    className={fieldClass}
                  />
                </div>

                <div>
                  <label
                    htmlFor="academy-course-category"
                    className={labelClass}
                  >
                    Category *
                  </label>

                  <input
                    id="academy-course-category"
                    name="category"
                    type="text"
                    required
                    value={courseForm.category}
                    onChange={updateCourseFormField}
                    placeholder="e.g. NAILS & BEAUTY"
                    className={fieldClass}
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="academy-course-description"
                  className={labelClass}
                >
                  Short Description *
                </label>

                <textarea
                  id="academy-course-description"
                  name="description"
                  required
                  rows={3}
                  value={courseForm.description}
                  onChange={updateCourseFormField}
                  placeholder="A short summary shown on the course card."
                  className={fieldClass}
                />
              </div>

              <div>
                <label
                  htmlFor="academy-course-full-description"
                  className={labelClass}
                >
                  Full Description
                </label>

                <textarea
                  id="academy-course-full-description"
                  name="fullDescription"
                  rows={4}
                  value={courseForm.fullDescription}
                  onChange={updateCourseFormField}
                  placeholder="Explain the course in more detail."
                  className={fieldClass}
                />
              </div>

              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="academy-course-duration"
                    className={labelClass}
                  >
                    Duration *
                  </label>

                  <input
                    id="academy-course-duration"
                    name="duration"
                    type="text"
                    required
                    value={courseForm.duration}
                    onChange={updateCourseFormField}
                    placeholder="e.g. 8 weeks"
                    className={fieldClass}
                  />
                </div>

                <div>
                  <label
                    htmlFor="academy-course-fee"
                    className={labelClass}
                  >
                    Course Fee (NGN) *
                  </label>

                  <input
                    id="academy-course-fee"
                    name="fee"
                    type="number"
                    min="0"
                    step="1"
                    required
                    value={courseForm.fee}
                    onChange={updateCourseFormField}
                    placeholder="e.g. 75000"
                    className={fieldClass}
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="academy-course-eligibility"
                  className={labelClass}
                >
                  Eligibility Requirements *
                </label>

                <textarea
                  id="academy-course-eligibility"
                  name="eligibility"
                  required
                  rows={3}
                  value={courseForm.eligibility}
                  onChange={updateCourseFormField}
                  placeholder="Who can apply for this course?"
                  className={fieldClass}
                />
              </div>

              <div>
                <label
                  htmlFor="academy-course-prerequisites"
                  className={labelClass}
                >
                  Prerequisites
                </label>

                <textarea
                  id="academy-course-prerequisites"
                  name="prerequisites"
                  rows={3}
                  value={courseForm.prerequisites}
                  onChange={updateCourseFormField}
                  placeholder="What should students know or have before enrolling?"
                  className={fieldClass}
                />
              </div>

              <div>
                <label
                  htmlFor="academy-course-format"
                  className={labelClass}
                >
                  Training Format
                </label>

                <select
                  id="academy-course-format"
                  name="format"
                  value={courseForm.format}
                  onChange={updateCourseFormField}
                  className={fieldClass}
                >
                  <option value="In-person">In-person</option>
                  <option value="Online">Online</option>
                  <option value="Hybrid">Hybrid</option>
                  <option value="Self-paced">Self-paced</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="academy-course-curriculum"
                  className={labelClass}
                >
                  Course Curriculum
                </label>

                <textarea
                  id="academy-course-curriculum"
                  name="curriculum"
                  rows={6}
                  value={courseForm.curriculum}
                  onChange={updateCourseFormField}
                  placeholder={
                    "Enter one topic per line:\nIntroduction to the course\nTools and materials\nPractical training\nFinal assessment"
                  }
                  className={fieldClass}
                />

                <p className="mt-2 text-xs leading-5 text-[#8B8071]">
                  Enter one topic per line. Each line becomes an item
                  in the course curriculum.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <label className="flex items-start gap-3 rounded-xl border border-[#EADFCB] bg-white p-4 text-sm text-[#6D501C]">
                  <input
                    type="checkbox"
                    name="certificate"
                    checked={courseForm.certificate}
                    onChange={updateCourseFormField}
                    className="mt-1 accent-[#B18A2B]"
                  />

                  <span>
                    <strong className="block">Certificate</strong>
                    <span className="mt-1 block text-xs leading-5 text-[#766A58]">
                      Certificate indicated for this course.
                    </span>
                  </span>
                </label>

                <label className="flex items-start gap-3 rounded-xl border border-[#EADFCB] bg-white p-4 text-sm text-[#6D501C]">
                  <input
                    type="checkbox"
                    name="enrollmentOpen"
                    checked={courseForm.enrollmentOpen}
                    onChange={updateCourseFormField}
                    className="mt-1 accent-[#B18A2B]"
                  />

                  <span>
                    <strong className="block">Enrolment Open</strong>
                    <span className="mt-1 block text-xs leading-5 text-[#766A58]">
                      Allow students to enrol.
                    </span>
                  </span>
                </label>

                <label className="flex items-start gap-3 rounded-xl border border-[#EADFCB] bg-white p-4 text-sm text-[#6D501C]">
                  <input
                    type="checkbox"
                    name="isPublished"
                    checked={courseForm.isPublished}
                    onChange={updateCourseFormField}
                    className="mt-1 accent-[#B18A2B]"
                  />

                  <span>
                    <strong className="block">Published</strong>
                    <span className="mt-1 block text-xs leading-5 text-[#766A58]">
                      Show this course to students.
                    </span>
                  </span>
                </label>
              </div>

              {courseFormError && (
                <div
                  role="alert"
                  className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-700"
                >
                  {courseFormError}
                </div>
              )}

              <div className="flex flex-col gap-3 border-t border-[#EADFCB] pt-5 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={closeCourseForm}
                  disabled={savingCourse}
                  className="rounded-xl border border-[#E7D8B8] px-5 py-3 text-sm font-semibold text-[#6D501C] transition hover:bg-[#F5EBD5] disabled:opacity-50"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={savingCourse}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#D4AF37] px-6 py-3 text-sm font-semibold text-[#3F3528] transition hover:bg-[#E7C65C] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {savingCourse
                    ? "Saving Course..."
                    : editingCourse
                      ? "Save Changes"
                      : "Add Course"}

                  {!savingCourse && <FaCheckCircle />}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
};

export default Academy;

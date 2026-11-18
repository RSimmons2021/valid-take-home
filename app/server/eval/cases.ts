import type { RawPlan } from "../ai/brief";

export const briefCases: { id: string; brief: string; supported: boolean; mustPrefer: string[]; competitor: string | null; fixture: RawPlan }[] = [
  {
    id: "mobile-dog-groomer",
    brief: "I run a mobile dog grooming van. Most customers book every month. I want areas with lots of dog owners and fewer competing groomers.",
    supported: true,
    mustPrefer: ["pet_life"],
    competitor: "pet_care",
    fixture: {
      supported: true,
      name: "Mobile dog grooming",
      summary: "Dog owners looking for a regular groom at home.",
      weights: [
        { factor: "pet_life", weight: 2, reason: "Vets and dog parks point to local dog owners" },
        { factor: "homes", weight: 1, reason: "More nearby homes help fill the van's route" },
        { factor: "pet_care", weight: -1, reason: "Competing groomers make it harder to win bookings" },
      ],
      competitor: "pet_care",
      note: "",
    },
  },
  {
    id: "home-repair-subscription",
    brief: "We sell a monthly handyman membership for people who own single-family homes. We want areas with homeowners who do a lot of repairs and few competing trades.",
    supported: true,
    mustPrefer: ["single", "home_retail"],
    competitor: "home_trades",
    fixture: {
      supported: true,
      name: "Handyman membership",
      summary: "People living in single-family homes who need help with repairs.",
      weights: [
        { factor: "single", weight: 2, reason: "Single-address rooftops suggest more stand-alone homes" },
        { factor: "home_retail", weight: 1, reason: "Hardware shops serve nearby households doing repairs" },
        { factor: "home_trades", weight: -1, reason: "Competing trades can draw away local jobs" },
      ],
      competitor: "home_trades",
      note: "",
    },
  },
  {
    id: "remote-b2b",
    brief: "We sell a remote-only compliance API to enterprise procurement teams across the US. Our customers never visit and we don't serve households.",
    supported: false,
    mustPrefer: [],
    competitor: null,
    fixture: {
      supported: false,
      name: "Compliance API",
      summary: "",
      weights: [],
      competitor: null,
      note: "Catchment plans for services that sell to local households.",
    },
  },
];

"use client";

import { Walkthrough } from "./walkthrough/Walkthrough";

/** Kept for existing imports: the inspection walk-through on its own. */
export function InspectionDemo() {
  return <Walkthrough only={["inspection"]} />;
}

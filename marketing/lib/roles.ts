import type { Role } from "@/components/RolesShowcase";

/* The seven roles shown in the roles showcase. Figures on the sample screens are illustrative. */
export const ROLES: Role[] = [
  { id: "driver", label: "Driver", title: "Report it before the next trip.", text: "Daily checks, meter readings and problems reported from the phone in a minute, in Arabic or English, with or without signal.",
    screen: ["Pre-trip checklist for this vehicle", "Report a problem with a photo", "Odometer or hour meter with a photo", "Accident report with GPS and damage marks"],
    kpis: [["Checks done today", "1 of 1"], ["Open problems on my vehicle", "0"]], devices: ["phone"] },
  { id: "tech", label: "Technician", title: "Your jobs, in order, on the phone.", text: "See the jobs assigned to you, start and pause them with a reason, record parts and labour, and close with photos and a signature.",
    screen: ["My jobs by priority", "Start, pause for parts, finish", "Tyre fitment by wheel position", "Inspection photos and signature"],
    kpis: [["Jobs today", "4"], ["Productive time", "6 h 10"]], devices: ["phone"] },
  { id: "tyre", label: "Tyre fitter", title: "Every wheel, every reading, every serial.", text: "Walk round with the tyre map, scan or type the serial, record the condition and pressure of each wheel, and see which tyres are close to the end of their expected life.",
    screen: ["Tyre map per vehicle type", "Serial scan opens the tyre history", "TPMS pressure alerts via telematics", "Tyres due in the next 30 days"],
    kpis: [["Tyres due in 30 days", "46"], ["Pressure compliance", "96%"]], devices: ["phone", "web"] },
  { id: "store", label: "Storekeeper", title: "Issue parts without the paperwork.", text: "See what each job needs, issue stock against the job card, and raise a purchase request when the reorder level is reached.",
    screen: ["Parts requested by open jobs", "Issue against the job card", "Stock and reorder level by site", "Purchase requests waiting approval"],
    kpis: [["Requests waiting", "3"], ["Below reorder level", "7 items"]], devices: ["web", "phone"] },
  { id: "sup", label: "Supervisor", title: "See the day before it starts.", text: "Approve inspections and jobs, assign the right technician, and follow every open job and every machine that is down.",
    screen: ["Approvals with signature", "Live workshop board", "Machines out of production", "Suggested technician for each job"],
    kpis: [["Waiting your approval", "5"], ["Machines down now", "4"]], devices: ["web", "phone", "tv"] },
  { id: "claims", label: "HSE and insurance", title: "One case, every document ready.", text: "Accident cases with photos, damage, root cause and the claim documents in one place, so the insurer has less to send back.",
    screen: ["Accident register by severity", "Root cause and actions", "Claim documents checklist", "Claimed, approved and recovered"],
    kpis: [["Open cases", "6"], ["Recovered this year", "SAR 184k"]], devices: ["web"] },
  { id: "pmv", label: "PMV manager", title: "Availability and cost, asset by asset.", text: "Availability, preventive compliance, cost per km or hour and anomalies across every site and country, each in its own currency.",
    screen: ["Fleet availability and downtime causes", "Cost per km by asset and brand", "Anomalies and data checks", "Repair, replace or move decisions"],
    kpis: [["Fleet availability", "93%"], ["Cost per km", "SAR 0.93"]], devices: ["web", "tv"] },
];

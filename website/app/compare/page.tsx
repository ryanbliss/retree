import { redirect } from "next/navigation";

/** /compare redirects to the narrative pitch (spec §4). */
export default function ComparePage() {
    redirect("/why");
}

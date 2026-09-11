import { LandingNav } from "@/components/landing/LandingNav";
import { Hero } from "@/components/landing/Hero";
import {
  Approach,
  ClosingCta,
  HowItWorks,
  ProblemSection,
  Technology,
} from "@/components/landing/Sections";
import { Footer } from "@/components/landing/Footer";

export default function LandingPage() {
  return (
    <>
      <LandingNav />
      <main>
        <Hero />
        <ProblemSection />
        <HowItWorks />
        <Approach />
        <Technology />
        <ClosingCta />
      </main>
      <Footer />
    </>
  );
}

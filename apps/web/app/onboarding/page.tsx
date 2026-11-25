import OnboardingGuide from "../../components/OnboardingGuide";
import { onboardingScreenParam, parseOnboardingScreen } from "../../lib/onboarding";

/** `?tela=<screen>` comes from the help link of a screen and opens the guide on its walkthrough. */
export default async function OnboardingPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const initialScreen = parseOnboardingScreen((await searchParams)[onboardingScreenParam]);
  // A help link from another screen remounts the guide, so it opens that screen even if the guide was already open.
  return <OnboardingGuide key={initialScreen ?? ""} initialScreen={initialScreen} />;
}

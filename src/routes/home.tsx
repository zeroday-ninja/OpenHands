import { PrefetchPageLinks, useLocation } from "react-router";
import { HomeChatLauncher } from "#/components/features/home/home-chat-launcher";
import { FeatureAnnouncement } from "#/components/features/feature-trials/feature-announcement";
import { FeatureFeedback } from "#/components/features/feature-trials/feature-feedback";
import { featureTrialsOn } from "#/features/feature-trials";
import { LlmNotConfiguredBanner } from "#/components/features/home/llm-not-configured-banner";
import {
  isOnboardingPreviewActive,
  OnboardingHost,
} from "#/components/features/onboarding";

<PrefetchPageLinks page="/conversations/:conversationId" />;

function HomeScreen() {
  const location = useLocation();
  const isPreview = isOnboardingPreviewActive(location.search);

  return (
    <div
      data-testid="home-screen"
      className="custom-scrollbar-always h-full overflow-y-auto rounded-xl bg-transparent px-4 md:px-0 lg:px-10.5"
    >
      <div className="md:px-4 lg:px-0">
        <LlmNotConfiguredBanner />
      </div>

      {/* A feature this app shipped on its own introduces itself here and
          keeps its rating afterwards. `home-host-folders` has pointed at
          this screen since it shipped and announced itself to nobody,
          because nothing here hosted it. Both render nothing when they
          have nothing to say. */}
      <div className="md:px-4 lg:px-0">
        <FeatureAnnouncement trials={featureTrialsOn("/conversations")} />
        <FeatureFeedback trials={featureTrialsOn("/conversations")} />
      </div>

      <HomeChatLauncher />

      {!isPreview ? <OnboardingHost /> : null}
    </div>
  );
}

export default HomeScreen;

import { PrefetchPageLinks } from "react-router";
import { HomeChatLauncher } from "#/components/features/home/home-chat-launcher";
import { FeatureAnnouncement } from "#/components/features/feature-trials/feature-announcement";
import { FeatureFeedback } from "#/components/features/feature-trials/feature-feedback";
import { featureTrialsOn } from "#/features/feature-trials";
import { LlmNotConfiguredBanner } from "#/components/features/home/llm-not-configured-banner";

<PrefetchPageLinks page="/conversations/:conversationId" />;

/**
 * Home.
 *
 * It does not mount `OnboardingHost`. It used to, for the non-preview case,
 * and that branch could never run: the root replaces the whole app with the
 * first-run screen whenever onboarding is incomplete, and the host returns
 * null once it is complete, so the copy here rendered nothing in every
 * reachable state. The preview case is mounted from the root layout, which
 * is where a surface that replaces the app belongs.
 */
function HomeScreen() {
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
    </div>
  );
}

export default HomeScreen;

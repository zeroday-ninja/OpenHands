import { useState } from "react";
import { useAutomationSubPageNav } from "#/components/features/automations/dashboard/use-automation-sub-page-nav";
import { RecommendedAutomationsLauncher } from "#/components/features/automations/recommended-automations-launcher";
import { SearchInput } from "#/components/features/automations/search-input";
import {
  EMPTY_TEMPLATE_FILTERS,
  type TemplateFilters,
} from "#/components/features/automations/template-filter-chips";
import { ManifestSubpageLayout } from "#/components/features/manifest/manifest-subpage-layout";
import {
  automationInterfaceRejection,
  getTemplatesPageSpec,
} from "#/manifests/automation-interface";
import { RejectedManifestNotice } from "#/components/features/automations/rejected-manifest-notice";

/**
 * The templates sub-page. It exists only while the admitted interface
 * manifest declares it — like a setup route for an id no entry claims, an
 * undeclared page is a 404 rendered by the layout's error boundary.
 *
 * Not for a manifest that was published and refused, though: that is a defect
 * in the pinned package, and "not found" sends someone looking for a page
 * that was taken away from them without a word.
 */
export const clientLoader = () => {
  if (automationInterfaceRejection()) return null;
  if (!getTemplatesPageSpec()) {
    throw new Response(null, { status: 404, statusText: "Not Found" });
  }
  return null;
};

function AutomationTemplatesPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [filters, setFilters] = useState<TemplateFilters>(
    EMPTY_TEMPLATE_FILTERS,
  );
  const spec = getTemplatesPageSpec();
  const nav = useAutomationSubPageNav();

  if (!spec || !nav) return null;

  return (
    <ManifestSubpageLayout
      heading={nav.heading}
      navTestIdBase="automations-navbar"
      items={nav.items}
    >
      <div className="min-w-0">
        <h1 className="text-xl font-semibold text-content">{spec.title}</h1>
        <p className="mt-1 text-sm text-muted">{spec.description}</p>
      </div>
      <div className="w-full">
        <SearchInput value={searchQuery} onChange={setSearchQuery} />
      </div>
      <RecommendedAutomationsLauncher
        query={searchQuery}
        onClearQuery={() => setSearchQuery("")}
        filters={filters}
        onFiltersChange={setFilters}
      />
    </ManifestSubpageLayout>
  );
}

/**
 * The page, or why there is no page.
 *
 * A wrapper rather than an early return inside the page itself: everything in
 * there reads the admitted manifest, which by definition is not there when the
 * published one was refused.
 */
export default function AutomationTemplates() {
  const rejection = automationInterfaceRejection();
  if (rejection) return <RejectedManifestNotice reason={rejection} />;
  return <AutomationTemplatesPage />;
}

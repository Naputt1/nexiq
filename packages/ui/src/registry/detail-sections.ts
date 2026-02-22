import type { DetailSection } from "@react-map/extension-sdk";
import { BasicInfoSection } from "@/components/details-sections/BasicInfoSection";
import { PropsSection } from "@/components/details-sections/PropsSection";
import { ChildrenSection } from "@/components/details-sections/ChildrenSection";
import { HooksSection } from "@/components/details-sections/HooksSection";
import { GitSection } from "@/components/details-sections/GitSection";

const registry: DetailSection[] = [
  {
    id: "basic-info",
    title: "Basic Info",
    priority: 0,
    component: BasicInfoSection,
    shouldShow: () => true,
    defaultOpen: true,
  },
  {
    id: "props",
    title: "Props",
    priority: 10,
    component: PropsSection,
    shouldShow: (item) =>
      !!(item.propType || (item.props && item.props.length > 0)),
    defaultOpen: true,
  },
  {
    id: "children",
    title: "Children",
    priority: 20,
    component: ChildrenSection,
    shouldShow: (item) => item.type === "component" && !!item.children,
  },
  {
    id: "hooks",
    title: "Hooks",
    priority: 30,
    component: HooksSection,
    shouldShow: (item) => !!(item.hooks && item.hooks.length > 0),
  },
  {
    id: "git",
    title: "Git",
    priority: 40,
    component: GitSection,
    shouldShow: (item) => !!item.gitStatus,
  },
];

/**
 * Returns a prioritized list of detail sections.
 */
export function getDetailSections(): DetailSection[] {
  return [...registry].sort((a, b) => a.priority - b.priority);
}

/**
 * Registers a new detail section.
 */
export function registerDetailSection(section: DetailSection) {
  registry.push(section);
}

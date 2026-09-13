import BulkHealthCheck from './bulk-health-check';
import BulkTokenCenter from './bulk-token-center';
import BmTokenCreatorHub from './bm-token-creator-hub';
import CopyPolish from './copy-polish';
import CrmResourcePush from './crm-resource-push';
import EncodingRepair from './encoding-repair';
import EztoolDashboard from './eztool-dashboard';
import EztoolReferenceSkin from './eztool-reference-skin';
import GuideWorkspaceSection from './guide-workspace-section';
import MetaOAuthConnector from './meta-oauth-connector';
import ProductionQueue from './production-queue';
import ResourceCenter from './resource-center';
import ResourcePresetManager from './resource-preset-manager';
import TokenImportCompat from './token-import-compat';
import TokenWorkspaceSection from './token-workspace-section';
import WorkflowRunner from './workflow-runner';

export default function Page() {
  return (
    <>
      <EncodingRepair />
      <CopyPolish />
      <EztoolDashboard />
      <EztoolReferenceSkin />
      <BulkTokenCenter />
      <TokenImportCompat />
      <TokenWorkspaceSection />
      <BmTokenCreatorHub />
      <ResourceCenter />
      <BulkHealthCheck />
      <ProductionQueue />
      <ResourcePresetManager />
      <GuideWorkspaceSection />
      <MetaOAuthConnector />
      <CrmResourcePush />
      <WorkflowRunner />
    </>
  );
}

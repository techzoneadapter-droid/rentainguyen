import CredentialImportSync from '../credential-import-sync';
import MixedCredentialImport from '../mixed-credential-import';
import ResourceConsoleV5 from '../resource-console-v5';

export default function NewDashboardPage() {
  return (
    <>
      <CredentialImportSync />
      <MixedCredentialImport />
      <ResourceConsoleV5 />
    </>
  );
}

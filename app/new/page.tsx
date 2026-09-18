import CredentialImportSync from '../credential-import-sync';
import MixedCredentialImport from '../mixed-credential-import';
import CredentialVaultPanel from '../credential-vault-panel';
import ResourceConsoleV5 from '../resource-console-v5';

export default function NewDashboardPage() {
  return (
    <>
      <CredentialImportSync />
      <MixedCredentialImport />
      <CredentialVaultPanel />
      <ResourceConsoleV5 />
    </>
  );
}

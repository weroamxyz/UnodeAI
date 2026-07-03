/*---------------------------------------------------------------------------------------------
 *  UnodeAi - SecretsManager
 *  Thin wrapper over VS Code SecretStorage so API keys never touch config files, logs, or Git.
 *  Keys are namespaced under "roam.secret.<name>" to avoid clashing with other extensions.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

const PREFIX = 'roam.secret.';

export class SecretsManager {
  constructor(private storage: vscode.SecretStorage) {}

  async get(secretName: string): Promise<string | undefined> {
    return this.storage.get(PREFIX + secretName);
  }

  async set(secretName: string, value: string): Promise<void> {
    await this.storage.store(PREFIX + secretName, value);
  }

  async delete(secretName: string): Promise<void> {
    await this.storage.delete(PREFIX + secretName);
  }

  async has(secretName: string): Promise<boolean> {
    return (await this.get(secretName)) !== undefined;
  }

  /**
   * Prompt the user to enter a secret (masked) and store it. Returns true if stored.
   */
  async promptAndStore(secretName: string, label: string): Promise<boolean> {
    const value = await vscode.window.showInputBox({
      title: `UnodeAi — Set ${label}`,
      prompt: `Enter value for ${secretName}. Stored encrypted in VS Code SecretStorage.`,
      password: true,
      ignoreFocusOut: true,
    });
    if (!value) {
      return false;
    }
    await this.set(secretName, value);
    return true;
  }
}

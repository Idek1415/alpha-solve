import { Component, signal, output, input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Plugin } from '../../models';

interface RecommendedPlugin {
  name: string;
  description: string;
  url: string;
}

@Component({
  selector: 'app-plugin-manager',
  imports: [FormsModule],
  templateUrl: './plugin-manager.component.html',
  styleUrl: './plugin-manager.component.css',
  standalone: true
})
export class PluginManagerComponent {
  // Inputs
  plugins = input.required<Plugin[]>();
  pluginUrls = input.required<string[]>();
  isOpen = input.required<boolean>();

  // Outputs
  close = output<void>();
  addPluginUrl = output<string>();
  removePluginUrl = output<string>();

  // Local state
  protected newPluginUrl = '';

  // Recommended plugins list
  protected readonly recommendedPlugins: RecommendedPlugin[] = [
    {
      name: 'Alpha Solve Analytical',
      description: 'Analytical solution plugin for solving equations and mathematical problems',
      url: 'https://github.com/icanthink42/alpha_solve_analytical.git'
    },
    {
      name: 'Alpha Solve Numerical',
      description: 'Numerical methods plugin for for solving equations and evaluating expressions',
      url: 'https://github.com/icanthink42/alpha_solve_numerical.git'
    }
  ];

  /**
   * Close the plugin manager
   */
  protected closeManager(): void {
    this.newPluginUrl = '';
    this.close.emit();
  }

  /**
   * Add a new plugin URL
   */
  protected async addPlugin(): Promise<void> {
    const url = this.newPluginUrl.trim();

    if (!url) {
      return;
    }

    // Validate URL format
    if (!url.startsWith('https://') || !url.includes('.git')) {
      alert('Please enter a valid HTTPS git repository URL (ending with .git)');
      return;
    }

    // Check if URL already exists
    if (this.pluginUrls().includes(url)) {
      alert('This plugin URL is already added');
      return;
    }

    // Emit event to add URL
    this.addPluginUrl.emit(url);
    this.newPluginUrl = '';
  }

  /**
   * Remove a plugin URL
   */
  protected removePlugin(url: string): void {
    this.removePluginUrl.emit(url);
  }

  /**
   * Get plugin by URL
   */
  protected getPluginByUrl(url: string): Plugin | undefined {
    const index = this.pluginUrls().indexOf(url);
    return index !== -1 ? this.plugins()[index] : undefined;
  }

  /**
   * Get recommended plugins that are not already installed
   */
  protected getAvailableRecommendedPlugins(): RecommendedPlugin[] {
    return this.recommendedPlugins.filter(
      recommended => !this.pluginUrls().includes(recommended.url)
    );
  }

  /**
   * Add a recommended plugin
   */
  protected addRecommendedPlugin(plugin: RecommendedPlugin): void {
    this.addPluginUrl.emit(plugin.url);
  }
}


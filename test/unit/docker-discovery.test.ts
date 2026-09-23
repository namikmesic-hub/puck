import { describe, expect, it, vi } from 'vitest';
import {
  discoverDocker,
  DOCKER_BIN_ENV,
  DockerNotFoundError,
  wellKnownDockerPaths,
  type DiscoveryDeps,
} from '../../src/main/docker-discovery';

// A Finder-launched app inherits launchd's PATH, not the shell's — the
// discovery order (configured → well-known → PATH → login shell) is the
// contract, and the error must say exactly what was searched.

function deps(over: Partial<DiscoveryDeps> & { executables?: string[] } = {}): DiscoveryDeps & {
  probe: ReturnType<typeof vi.fn>;
} {
  const executables = new Set(over.executables ?? []);
  const probe = vi.fn(async () => null as string | null);
  return {
    env: over.env ?? { PATH: '/usr/bin:/bin' },
    homedir: over.homedir ?? '/Users/test',
    isExecutable: over.isExecutable ?? ((p) => executables.has(p)),
    loginShellProbe: over.loginShellProbe ?? probe,
    probe,
  };
}

describe('docker discovery', () => {
  it('an explicit configured binary wins and nothing else is probed', async () => {
    const d = deps({ env: { [DOCKER_BIN_ENV]: '/custom/docker', PATH: '/usr/bin' }, executables: ['/custom/docker', '/usr/local/bin/docker'] });
    await expect(discoverDocker(d)).resolves.toEqual({ path: '/custom/docker', source: 'configured' });
    expect(d.probe).not.toHaveBeenCalled();
  });

  it('a configured binary that is not executable is an error, never silently replaced', async () => {
    const d = deps({ env: { [DOCKER_BIN_ENV]: '/nope/docker', PATH: '/usr/bin' }, executables: ['/usr/local/bin/docker'] });
    await expect(discoverDocker(d)).rejects.toThrow(new RegExp(`${DOCKER_BIN_ENV} is set to "/nope/docker"`));
  });

  it('well-known install locations beat the inherited PATH, in the documented order', async () => {
    const home = '/Users/test';
    const order = wellKnownDockerPaths(home);
    expect(order[0]).toBe('/usr/local/bin/docker');
    expect(order).toContain('/opt/homebrew/bin/docker');
    expect(order).toContain('/Applications/Docker.app/Contents/Resources/bin/docker');
    expect(order).toContain(`${home}/.docker/bin/docker`);
    const d = deps({
      env: { PATH: '/weird/bin' },
      executables: ['/weird/bin/docker', '/opt/homebrew/bin/docker', `${home}/.docker/bin/docker`],
    });
    await expect(discoverDocker(d)).resolves.toEqual({ path: '/opt/homebrew/bin/docker', source: 'well-known' });
    expect(d.probe).not.toHaveBeenCalled();
  });

  it('falls back to the inherited PATH when no well-known location exists', async () => {
    const d = deps({ env: { PATH: '/usr/bin:/some/tools/bin' }, executables: ['/some/tools/bin/docker'] });
    await expect(discoverDocker(d)).resolves.toEqual({ path: '/some/tools/bin/docker', source: 'inherited-path' });
    expect(d.probe).not.toHaveBeenCalled();
  });

  it('asks the login shell last and trusts only an executable answer', async () => {
    const probe = vi.fn(async () => '/nix/store/abc/bin/docker');
    const d = deps({
      env: { PATH: '/usr/bin', SHELL: '/bin/zsh' },
      executables: ['/nix/store/abc/bin/docker'],
      loginShellProbe: probe,
    });
    await expect(discoverDocker(d)).resolves.toEqual({ path: '/nix/store/abc/bin/docker', source: 'login-shell' });
    expect(probe).toHaveBeenCalledWith('/bin/zsh');
  });

  it('when nothing works the error names every step that was searched', async () => {
    const d = deps({ env: { PATH: '/usr/bin:/bin', SHELL: '/bin/zsh' } });
    const err = await discoverDocker(d).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DockerNotFoundError);
    const message = (err as Error).message;
    expect(message).toContain(`${DOCKER_BIN_ENV} (unset)`);
    for (const p of wellKnownDockerPaths('/Users/test')) expect(message).toContain(p);
    expect(message).toContain('PATH (/usr/bin:/bin)');
    expect(message).toContain("login shell (/bin/zsh -lc 'command -v docker')");
    expect(message).toMatch(/Install Docker Desktop or colima/);
  });
});

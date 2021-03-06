// @flow

import {
  Android,
  Config,
  Exp,
  Project,
  ProjectSettings,
  Simulator,
  UrlUtils,
  User,
  UserSettings,
} from 'xdl';

import chalk from 'chalk';
import opn from 'opn';
import readline from 'readline';
import wordwrap from 'wordwrap';

import { loginOrRegisterIfLoggedOut } from '../../accounts';
import urlOpts from '../../urlOpts';
import log from '../../log';

const CTRL_C = '\u0003';
const CTRL_D = '\u0004';
const CTRL_L = '\u000C';

const { bold: b, italic: i, underline: u } = chalk;

const clearConsole = () => {
  process.stdout.write(process.platform === 'win32' ? '\x1Bc' : '\x1B[2J\x1B[3J\x1B[H');
};

const printHelp = () => {
  log.newLine();
  log.nested(`Press ${b('?')} to show a list of all available commands.`);
};

const printUsage = async projectDir => {
  const { dev } = await ProjectSettings.readAsync(projectDir);
  const openDevToolsAtStartup = await UserSettings.getAsync('openDevToolsAtStartup', true);
  const username = await User.getCurrentUsernameAsync();
  const devMode = dev ? 'development' : 'production';
  const iosInfo = process.platform === 'darwin' ? `, or ${b`i`} to run on ${u`i`}OS simulator` : '';
  log.nested(`
 \u203A Press ${b`a`} to run on ${u`A`}ndroid device/emulator${iosInfo}.
 \u203A Press ${b`c`} to show info on ${u`c`}onnecting new devices.
 \u203A Press ${b`d`} to open DevTools in the default web browser.
 \u203A Press ${b`shift-d`} to ${
    openDevToolsAtStartup ? 'disable' : 'enable'
  } automatically opening ${u`D`}evTools at startup.
 \u203A Press ${b`e`} to send an app link with ${u`e`}mail/SMS.
 \u203A Press ${b`p`} to toggle ${u`p`}roduction mode. (current mode: ${i(devMode)})
 \u203A Press ${b`r`} to ${u`r`}estart bundler, or ${b`shift-r`} to restart and clear cache.
 \u203A Press ${b`s`} to ${u`s`}ign ${
    username ? `out. (Signed in as ${i('@' + username)}.)` : 'in.'
  }
`);
};

export const printServerInfo = async projectDir => {
  const url = await UrlUtils.constructManifestUrlAsync(projectDir);
  const username = await User.getCurrentUsernameAsync();
  log.newLine();
  log.nested(`  ${u(url)}`);
  log.newLine();
  urlOpts.printQRCode(url);
  const wrap = wordwrap(2, process.stdout.columns || 80);
  const wrapItem = wordwrap(4, process.stdout.columns || 80);
  const item = text => '  \u2022 ' + wrapItem(text).trimStart();
  const iosInfo = process.platform === 'darwin' ? `, or ${b('i')} for iOS simulator` : '';
  log.nested(wrap(u('To run the app with live reloading, choose one of:')));
  if (username) {
    log.nested(
      item(
        `Sign in as ${i(
          '@' + username
        )} in Expo Client on Android or iOS. Your projects will automatically appear in the "Projects" tab.`
      )
    );
  }
  log.nested(item(`Scan the QR code above with the Expo app (Android) or the Camera app (iOS).`));
  log.nested(item(`Press ${b`a`} for Android emulator${iosInfo}.`));
  log.nested(item(`Press ${b`e`} to send a link to your phone with email/SMS.`));
  if (!username) {
    log.nested(item(`Press ${b`s`} to sign in and enable more options.`));
  }
  printHelp();
};

export const startAsync = async projectDir => {
  const { stdin } = process;
  const startWaitingForCommand = () => {
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    stdin.on('data', handleKeypress);
  };

  const stopWaitingForCommand = () => {
    stdin.removeListener('data', handleKeypress);
    stdin.setRawMode(false);
    stdin.resume();
  };

  startWaitingForCommand();

  await printServerInfo(projectDir);

  async function handleKeypress(key) {
    switch (key) {
      case CTRL_C:
      case CTRL_D: {
        process.emit('SIGINT');
        return;
      }
      case CTRL_L: {
        clearConsole();
        return;
      }
      case '?': {
        await printUsage(projectDir);
        return;
      }
      case 'a': {
        clearConsole();
        log('Trying to open the project on Android...');
        const { success, error } = await Android.openProjectAsync(projectDir);
        printHelp();
        return;
      }
      case 'i': {
        clearConsole();
        log('Trying to open the project in iOS simulator...');
        const { success, msg } = await Simulator.openProjectAsync(projectDir);
        printHelp();
        return;
      }
      case 'c': {
        clearConsole();
        await printServerInfo(projectDir);
        return;
      }
      case 'd': {
        const { devToolsPort } = await ProjectSettings.readPackagerInfoAsync(projectDir);
        log('Opening DevTools in the browser...');
        opn(`http://localhost:${devToolsPort}`, { wait: false });
        printHelp();
        return;
      }
      case 'D': {
        clearConsole();
        const enabled = !(await UserSettings.getAsync('openDevToolsAtStartup', true));
        await UserSettings.setAsync('openDevToolsAtStartup', enabled);
        log(
          `Automatically opening DevTools ${b(
            enabled ? 'enabled' : 'disabled'
          )}.\nPress ${b`d`} to open DevTools now.`
        );
        printHelp();
        return;
      }
      case 'e': {
        stopWaitingForCommand();
        const lanAddress = await UrlUtils.constructManifestUrlAsync(projectDir, {
          hostType: 'lan',
        });
        const defaultRecipient = await UserSettings.getAsync('sendTo', null);
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });
        const handleKeypress = (chr, key) => {
          if (key && key.name === 'escape') {
            cleanup();
            cancel();
          }
        };
        const cleanup = () => {
          rl.close();
          process.stdin.removeListener('keypress', handleKeypress);
          startWaitingForCommand();
        };
        const cancel = async () => {
          clearConsole();
          printHelp();
        };
        clearConsole();
        process.stdin.addListener('keypress', handleKeypress);
        log('Please enter your phone number or email address (press ESC to cancel) ');
        rl.question(defaultRecipient ? `[default: ${defaultRecipient}]> ` : '> ', async sendTo => {
          cleanup();
          if (!sendTo && defaultRecipient) {
            sendTo = defaultRecipient;
          }
          sendTo = sendTo && sendTo.trim();
          if (!sendTo) {
            cancel();
            return;
          }
          log(`Sending ${lanAddress} to ${sendTo}...`);

          let sent = false;
          try {
            await Exp.sendAsync(sendTo, lanAddress);
            log(`Sent link successfully.`);
            sent = true;
          } catch (err) {
            log(`Could not send link. ${err}`);
          }
          printHelp();
          if (sent) {
            await UserSettings.setAsync('sendTo', sendTo);
          }
        });
        return;
      }
      case 'p': {
        clearConsole();
        const projectSettings = await ProjectSettings.readAsync(projectDir);
        const dev = !projectSettings.dev;
        await ProjectSettings.setAsync(projectDir, { dev, minify: !dev });
        log(
          `Metro Bundler is now running in ${chalk.bold(
            dev ? 'development' : 'production'
          )}${chalk.reset(` mode.`)}
Please reload the project in the Expo app for the change to take effect.`
        );
        printHelp();
        return;
      }
      case 'r':
      case 'R': {
        clearConsole();
        const reset = key === 'R';
        if (reset) {
          log('Restarting Metro Bundler and clearing cache...');
        } else {
          log('Restarting Metro Bundler...');
        }
        Project.startAsync(projectDir, { reset });
        return;
      }
      case 's': {
        const authSession = await User.getSessionAsync();
        if (authSession) {
          await User.logoutAsync();
          log('Signed out.');
        } else {
          stopWaitingForCommand();
          try {
            await loginOrRegisterIfLoggedOut();
          } catch (e) {
            log.error(e);
          } finally {
            startWaitingForCommand();
          }
        }
        printHelp();
        return;
      }
    }
  }
};

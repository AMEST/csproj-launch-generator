// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as jsonParse from 'jsonc-parser';

export function activate(context: vscode.ExtensionContext) {

	console.log('csproj-launch-generator is now active!');

	context.subscriptions.push(vscode.commands.registerCommand('csproj-launch-generator.generate-launch', async (args) => {
		if (vscode.workspace.workspaceFolders === undefined) {
			vscode.window.showErrorMessage(`This window hasn't opened workspace directories`);
			return;
		}

		if (args === undefined) {
			var currentOpenedFile = vscode.window.activeTextEditor?.document.uri;
			if(currentOpenedFile === undefined){
				vscode.window.showErrorMessage(`No opened csproj file in editor`);
				return;
			}
			if(!currentOpenedFile.fsPath.endsWith(".csproj")){
				vscode.window.showErrorMessage(`Opened file not csproj file`);
				return;
			}
			args = { path: currentOpenedFile };
		}

		await ensureVsCodeJsonFiles();

		let relativePath: string = vscode.workspace.asRelativePath(args.path);
		let splitedPath: string[] = relativePath.split("/");
		let csprojFileName: string = splitedPath[splitedPath.length - 1];

		let targetFramework = await getTargetFramework(args.path);
		if (targetFramework === null) {
			vscode.window.showErrorMessage(`Can't find TargetFramework inside ${relativePath}`);
			return;
		}

		await addTask(relativePath, csprojFileName);
		await addLaunch(relativePath, csprojFileName, targetFramework);

		vscode.window.showInformationMessage(`Launch and build configuration for ${relativePath} created!`);
	}));
}

// This method is called when your extension is deactivated
export function deactivate() { }

async function addTask(projectPath: string, projectName: string) {
	if (vscode.workspace.workspaceFolders === undefined) { return; }
	let workspaceHomeUri: vscode.Uri = vscode.workspace.workspaceFolders[0].uri;
	let workspaceTasksFileUri: vscode.Uri = vscode.Uri.joinPath(workspaceHomeUri, ".vscode", "tasks.json");
	let tasksContent = await getDocumentContent(workspaceTasksFileUri);

	let taskLabel: string = `build-${projectName.replace(".csproj", "")}`;

	if (tasksContent.indexOf(taskLabel) !== -1) {
		return;
	}
	
	let tasksObj: any = jsonParse.parse(tasksContent);
	tasksObj.tasks.push({
		"label": taskLabel,
		"command": "dotnet",
		"type": "process",
		"args": [
			"build",
			"${workspaceFolder}" + `/${projectPath}`,
			"/property:GenerateFullPaths=true",
			"/consoleloggerparameters:NoSummary"
		],
		"problemMatcher": "$msCompile"
	});
	fs.writeFileSync(workspaceTasksFileUri.fsPath, JSON.stringify(tasksObj, null, 4));
}

async function addLaunch(projectPath: string, projectName: string, targetFramework: string) {
	if (vscode.workspace.workspaceFolders === undefined) { return; }
	let workspaceHomeUri: vscode.Uri = vscode.workspace.workspaceFolders[0].uri;
	let workspaceLaunchFileUri: vscode.Uri = vscode.Uri.joinPath(workspaceHomeUri, ".vscode", "launch.json");
	let projectFullPath: vscode.Uri = vscode.Uri.joinPath(workspaceHomeUri, projectPath);
	let launchContent = await getDocumentContent(workspaceLaunchFileUri);

	let projectNameWithoutExtension: string = projectName.replace(".csproj", "");
	let buildTaskLabel: string = `build-${projectNameWithoutExtension}`;
	let projectDirPath: string = projectPath.replace(`/${projectName}`, "");

	if (launchContent.indexOf(buildTaskLabel) !== -1) {
		return;
	}

	let launchObject: any = jsonParse.parse(launchContent);

	let launchConfig: any = {
		"name": projectNameWithoutExtension,
		"type": "coreclr",
		"request": "launch",
		"preLaunchTask": buildTaskLabel,
		"program": "${workspaceFolder}" + `/${projectDirPath}/bin/Debug/${targetFramework}/${projectNameWithoutExtension}.dll`,
		"args": [],
		"cwd": "${workspaceFolder}" + `/${projectDirPath}`,
		"stopAtEntry": false
	};

	if (await isWebProject(projectFullPath)) {
		launchConfig["serverReadyAction"] = {
			"action": "openExternally",
			"pattern": "\\bNow listening on:\\s+(https?://\\S+)"
		};
		launchConfig["env"] = {
			"ASPNETCORE_ENVIRONMENT": "Development"
		};
		launchConfig["sourceFileMap"] = {
			"/Views": "${workspaceFolder}" + `/${projectDirPath}/Views`
		};
	} else {
		launchConfig["console"] = "internalConsole";
	}

	launchObject.configurations.push(launchConfig);

	fs.writeFileSync(workspaceLaunchFileUri.fsPath, JSON.stringify(launchObject, null, 4));
}

async function ensureVsCodeJsonFiles() {
	if (vscode.workspace.workspaceFolders === undefined) { return; }
	let workspaceHomeUri: vscode.Uri = vscode.workspace.workspaceFolders[0].uri;
	let workspaceVsCodeDirUri: vscode.Uri = vscode.Uri.joinPath(workspaceHomeUri, ".vscode/");
	let workspaceTasksFileUri: vscode.Uri = vscode.Uri.joinPath(workspaceHomeUri, ".vscode", "tasks.json");
	let workspaceLaunchFileUri: vscode.Uri = vscode.Uri.joinPath(workspaceHomeUri, ".vscode", "launch.json");

	if (!fs.existsSync(workspaceVsCodeDirUri.fsPath)) {
		fs.mkdirSync(workspaceVsCodeDirUri.fsPath);
	}

	if (!fs.existsSync(workspaceTasksFileUri.fsPath)) {
		var tasksTemplateFile = await getTemplateContent("tasks.json");
		fs.writeFileSync(workspaceTasksFileUri.fsPath, tasksTemplateFile);
	}

	if (!fs.existsSync(workspaceLaunchFileUri.fsPath)) {
		var tasksTemplateFile = await getTemplateContent("launch.json");
		fs.writeFileSync(workspaceLaunchFileUri.fsPath, tasksTemplateFile);
	}
}

async function getTargetFramework(fullPath: string) {
	var csprojContent = await getDocumentContent(vscode.Uri.parse(fullPath));
	var frameworkMatcher = csprojContent.match(/\<TargetFramework\>(.*)\<\/TargetFramework\>/);
	return frameworkMatcher === null || frameworkMatcher.length < 2 ? null : frameworkMatcher[1];
}

async function isWebProject(fullPath: vscode.Uri) {
	var csprojContent = await getDocumentContent(fullPath);
	return csprojContent.indexOf("<Project Sdk=\"Microsoft.NET.Sdk.Web\">") !== -1;
}

async function getTemplateContent(templateName: string) {
	var templatePath = vscode.extensions.getExtension('nb47.csproj-launch-generator')?.extensionPath + '/templates/' + templateName + ".tmpl";
	var templatePathUri = vscode.Uri.parse(templatePath);
	var tasksTemplateFile = await vscode.workspace.openTextDocument(templatePathUri.path);
	return tasksTemplateFile.getText();
}

async function getDocumentContent(path: vscode.Uri) {
	var documentFile = await vscode.workspace.openTextDocument(path);
	return documentFile.getText();
}
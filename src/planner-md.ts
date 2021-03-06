import type { MarkdownView, Workspace } from 'obsidian';
import { DAY_PLANNER_DEFAULT_CONTENT } from './constants';
import type DayPlannerFile from './file';
import PlannerMermaid from './mermaid';
import type Parser from './parser';
import type { PlanItem, PlanSummaryData } from './plan-data';
import type Progress from './progress';
import { DayPlannerSettings, NoteForDateQuery} from './settings';

export default class PlannerMarkdown {
    workspace: Workspace;
    dayPlannerLastEdit: number;
    settings: DayPlannerSettings;
    file: DayPlannerFile;
    parser: Parser;
    progress: Progress;
    mermaid: PlannerMermaid;
    noteForDateQuery: NoteForDateQuery;
    
    constructor(workspace: Workspace, settings: DayPlannerSettings, file: DayPlannerFile, parser: Parser, progress: Progress){
        this.workspace = workspace;
        this.settings = settings;
        this.file = file;
        this.parser = parser;
        this.progress = progress;
        this.mermaid = new PlannerMermaid(this.progress);
        this.noteForDateQuery = new NoteForDateQuery();
    }
    
    async insertPlanner() {
        const filePath = this.file.todayPlannerFilePath();
        const fileContents = await (await this.file.getFileContents(filePath)).split('\n');
        const view = this.workspace.activeLeaf.view as MarkdownView;
        const currentLine = view.sourceMode.cmEditor.getCursor().line;
        const insertResult = [...fileContents.slice(0, currentLine), ...DAY_PLANNER_DEFAULT_CONTENT.split('\n'), ...fileContents.slice(currentLine)];
        this.file.updateFile(filePath, insertResult.join('\n'));
    }

    async parseDayPlanner():Promise<PlanSummaryData> {
        try {
            const filePath = this.file.todayPlannerFilePath();
            const fileContent = await (await this.file.getFileContents(filePath)).split('\n');
            const {dayPlannerContents} = this.getPlannerSegment(fileContent);

            const planData = await this.parser.parseMarkdown(dayPlannerContents);
            return planData;
        } catch (error) {
            console.log(error)
        }
    }
    
    async updateDayPlannerMarkdown(planSummary: PlanSummaryData) {
        if((this.dayPlannerLastEdit + 6000) > new Date().getTime()) {
            return;
        }
        try {
            const filePath = this.file.todayPlannerFilePath();
            const fileContents = await (await this.file.getFileContents(filePath))
            const fileContentsArr = fileContents.split('\n');
            const {startLine, endLine} = this.getPlannerSegment(fileContentsArr);

            planSummary.calculate();
            if(planSummary.empty){
                return;
            }
            const results = planSummary.items.map((item, i) => {
                let result = '';
                if(item === planSummary.current){
                    result = item.isEnd ? this.updateItemCompletion(item, true) : this.currentItemText(planSummary);
                } else if(item.isUnMatched) {
                    result = item.raw;  
                } else {
                    result = this.updateItemCompletion(item, item.isPast);
                }
                return result;
            });

            const mermaidResult = this.settings.mermaid ? this.mermaid.generate(planSummary).split('\n') : [];
            const newFileContentsArr = fileContentsArr.slice(0, startLine).concat(mermaidResult).concat(results).concat(fileContentsArr.slice(endLine));
            const newFileContents = newFileContentsArr.join('\n')
            if(fileContents !== newFileContents){
                this.file.updateFile(filePath, newFileContents);
            }
        } catch (error) {
            console.log(error);
        }
    }

    private getPlannerSegment(fileContents: string[]): {startLine: number, endLine: number, dayPlannerContents: string[]} {
        let startLine = -1;
        let endLine = 0;
        for (let i = 0; i < fileContents.length; i++) {
            const dpc = fileContents[i];
            if(dpc.contains('# Day Planner')) {
                startLine = i+1;
            }
            if(dpc === '---' && startLine >= 0) {
                endLine = i-1;
                break;
            }
        }    
        const dayPlannerContents = fileContents.slice(startLine, endLine);
        return {startLine, endLine, dayPlannerContents}
    }

    private updateItemCompletion(item: PlanItem, complete: boolean) {
        let check = this.check(complete);
        //Override to use current (user inputted) state if plugin setting is enabled
        if(!this.settings.completePastItems) {
            check = this.check(item.isCompleted);
        }
        return `- [${check}] ${item.rawTime} ${item.displayText()}`;
    }

    private check(check: boolean) {
        return check ? 'x' : ' ';
    }
    
    private currentItemText(planSummary:PlanSummaryData): string{
        try {
            const current = planSummary.current;
            const next = planSummary.next;
    
            const progressMarkdown = `> ||${current.rawTime}||${this.progress.progressMarkdown(current, next)}||${next.rawTime}||`;
            let replacementItem = `\n**Current Task**\n\n${progressMarkdown}\n\n${this.updateItemCompletion(current, false)}`;      
            return replacementItem;
        } catch (error) {
            console.log(error)
        }
    }

    checkIsDayPlannerEditing(){
        const activeLeaf = this.workspace.activeLeaf;
        if(!activeLeaf){
            return;
        }
        const viewState = activeLeaf.view.getState();
        if(viewState.file === this.file.todayPlannerFilePath()){
            this.dayPlannerLastEdit = new Date().getTime();
        };
    }
}
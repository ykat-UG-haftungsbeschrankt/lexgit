import { OfficeLawSelectedCommitComparison }
	from "./selected-commit-comparison";
import type { GitCommand } from "./repository-comparison";
import type { RepositoryLawSnapshot } from "./history";

export class OfficeLawHeadCommitComparison{
	public destructor():void{}

	public static async compare(
		git:GitCommand,root:utf8_t,base:utf8_t
	):Promise<RepositoryLawSnapshot>{
		const hash=(await git(root,["rev-parse","HEAD"])).trim();
		return OfficeLawSelectedCommitComparison.compare(
			git,root,base,hash
		);
	}
};

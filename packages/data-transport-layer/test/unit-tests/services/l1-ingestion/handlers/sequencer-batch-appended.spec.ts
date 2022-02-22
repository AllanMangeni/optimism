import fs from 'fs'
import path from 'path'

import { BigNumber, ethers } from 'ethers'
import { compressBatchWithZlib } from '../../../../../src/utils'

const readMockData = () => {
  const mockDataPath = path.join(__dirname, '..', '..', '..', 'examples')
  const paths = fs.readdirSync(mockDataPath)
  const files = []
  for (const filename of paths) {
    // Skip non .txt files
    if (!filename.endsWith('.txt')) {
      continue
    }
    const filePath = path.join(mockDataPath, filename)
    const file = fs.readFileSync(filePath)
    const obj = JSON.parse(file.toString())
    // Reserialize the BigNumbers
    obj.input.extraData.prevTotalElements = BigNumber.from(
      obj.input.extraData.prevTotalElements
    )
    obj.input.extraData.batchIndex = BigNumber.from(
      obj.input.extraData.batchIndex
    )
    if (obj.input.event.args.length !== 3) {
      throw new Error(`ABI mismatch`)
    }
    obj.input.event.args = obj.input.event.args.map(BigNumber.from)
    obj.input.event.args._startingQueueIndex = obj.input.event.args[0]
    obj.input.event.args._numQueueElements = obj.input.event.args[1]
    obj.input.event.args._totalElements = obj.input.event.args[2]
    obj.input.extraData.batchSize = BigNumber.from(
      obj.input.extraData.batchSize
    )
    files.push(obj)
  }
  return files
}

/* Imports: Internal */
import { expect } from '../../../../setup'
import { handleEventsSequencerBatchAppended } from '../../../../../src/services/l1-ingestion/handlers/sequencer-batch-appended'
import { SequencerBatchAppendedExtraData } from '../../../../../src/types'

describe('Event Handlers: CanonicalTransactionChain.SequencerBatchAppended', () => {
  const mockData = readMockData()

  describe('handleEventsSequencerBatchAppended.parseEvent', () => {
    // This tests the behavior of parsing a real mainnet transaction,
    // so it will break if the encoding scheme changes.

    // Transaction and extra data from
    // https://etherscan.io/tx/0x6effe006836b841205ace4d99d7ae1b74ee96aac499a3f358b97fccd32ee9af2
    const exampleExtraData = {
      timestamp: 1614862375,
      blockNumber: 11969713,
      submitter: '0xfd7d4de366850c08ee2cba32d851385a3071ec8d',
      l1TransactionHash:
        '0x6effe006836b841205ace4d99d7ae1b74ee96aac499a3f358b97fccd32ee9af2',
      gasLimit: '548976',
      prevTotalElements: BigNumber.from(73677),
      batchIndex: BigNumber.from(743),
      batchSize: BigNumber.from(101),
      batchRoot:
        '10B99425FB53AD7D40A939205C0F7B35CBB89AB4D67E7AE64BDAC5F1073943B4',
      batchExtraData: '',
    }

    it('should error on malformed transaction data', async () => {
      const input1: [any, SequencerBatchAppendedExtraData, number] = [
        {
          args: {
            _startingQueueIndex: ethers.constants.Zero,
            _numQueueElements: ethers.constants.Zero,
            _totalElements: ethers.constants.Zero,
          },
        },
        {
          l1TransactionData: '0x00000',
          ...exampleExtraData,
        },
        0,
      ]

      expect(() => {
        handleEventsSequencerBatchAppended.parseEvent(...input1)
      }).to.throw(
        `Block ${input1[1].blockNumber} transaction data is invalid for decoding: ${input1[1].l1TransactionData} , ` +
          `converted buffer length is < 12.`
      )
    })

    describe('mainnet transactions', () => {
      for (const mock of mockData) {
        const { input, output } = mock
        const { event, extraData, l2ChainId } = input
        const hash = mock.input.extraData.l1TransactionHash

        it(`uncompressed: ${hash}`, () => {
          const res = handleEventsSequencerBatchAppended.parseEvent(
            event,
            extraData,
            l2ChainId
          )
          // Check all of the transaction entries individually
          for (const [i, got] of res.transactionEntries.entries()) {
            const expected = output.transactionEntries[i]
            expect(got).to.deep.eq(expected, `case ${i}`)
          }
          expect(res).to.deep.eq(output)
        })

        it(`compressed: ${hash}`, () => {
          const compressed = compressBatchWithZlib(
            input.extraData.l1TransactionData
          )

          const copy = { ...extraData }
          copy.l1TransactionData = compressed

          const res = handleEventsSequencerBatchAppended.parseEvent(
            event,
            copy,
            l2ChainId
          )

          expect(res).to.deep.eq(output)
        })
      }
    })
  })
})
